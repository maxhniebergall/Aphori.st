/**
 * Service for managing temporary users in the Themes game
 * Handles creation, validation, and cleanup of temporary user sessions
 */

import { LoggedDatabaseClient } from '../../db/LoggedDatabaseClient.js';
import { 
  TemporaryUserId, 
  THEMES_DB_PATHS, 
  THEMES_CONFIG 
} from '../../types/games/themes.js';
import {
  generateTempUserId,
  isTempUserExpired,
  calculateTempUserExpiry,
  getCurrentDateString
} from '../../config/database/games.js';
import logger from '../../logger.js';

export class TemporaryUserService {
  private firebaseClient: LoggedDatabaseClient;

  constructor(firebaseClient: LoggedDatabaseClient) {
    this.firebaseClient = firebaseClient;
  }

  /**
   * Create a new temporary user ID and store in database
   */
  async createTemporaryUser(): Promise<TemporaryUserId> {
    const tempId = generateTempUserId();
    const now = Date.now();
    const expiresAt = calculateTempUserExpiry(now);

    const tempUser: TemporaryUserId = {
      tempId,
      createdAt: now,
      lastAccessed: now,
      expiresAt
    };

    try {
      const path = THEMES_DB_PATHS.TEMP_USER(tempId);
      await this.firebaseClient.setRawPath(path, tempUser);
      
      logger.info(`Created temporary user: ${tempId}`);
      return tempUser;
    } catch (error) {
      logger.error('Failed to create temporary user:', error);
      throw new Error('Failed to create temporary user session');
    }
  }

  /**
   * Validate and refresh a temporary user ID
   * Returns the user data if valid, null if expired or invalid
   */
  async validateAndRefreshTempUser(tempId: string): Promise<TemporaryUserId | null> {
    // Validate tempId format: temp_{timestamp}_{random}
    // timestamp: base-36 encoded timestamp (variable length)
    // random: base-36 encoded random string (13 characters)
    const tempIdPattern = /^temp_[a-z0-9]+_[a-z0-9]{13}$/;
    
    if (!tempId || typeof tempId !== 'string' || !tempIdPattern.test(tempId)) {
      return null;
    }

    try {
      const path = THEMES_DB_PATHS.TEMP_USER(tempId);
      const userData = await this.firebaseClient.getRawPath(path);
      
      if (!userData) {
        logger.debug(`Temporary user not found: ${tempId}`);
        return null;
      }

      const tempUser = userData as TemporaryUserId;
      
      // Check if expired
      if (isTempUserExpired(tempUser.createdAt)) {
        logger.info(`Temporary user expired: ${tempId}`);
        await this.cleanupExpiredUser(tempId);
        return null;
      }

      // Refresh last accessed time
      const now = Date.now();
      const refreshedUser: TemporaryUserId = {
        ...tempUser,
        lastAccessed: now
      };

      await this.firebaseClient.setRawPath(path, refreshedUser);
      
      logger.debug(`Refreshed temporary user: ${tempId}`);
      return refreshedUser;
    } catch (error) {
      logger.error(`Failed to validate temporary user ${tempId}:`, error);
      return null;
    }
  }

  /**
   * Get or create temporary user from cookie/request
   * Returns existing user if valid, creates new one if needed
   */
  async getOrCreateTempUser(existingTempId?: string): Promise<TemporaryUserId> {
    if (existingTempId) {
      const validUser = await this.validateAndRefreshTempUser(existingTempId);
      if (validUser) {
        return validUser;
      }
    }

    // Create new temporary user
    return await this.createTemporaryUser();
  }

  /**
   * Migrate temporary user progress to permanent user account
   * Called when a temporary user creates a permanent account
   */
  async migrateTempUserToPermanent(tempId: string, permanentUserId: string): Promise<boolean> {
    try {
      // Get temporary user's game state
      const tempProgressPath = THEMES_DB_PATHS.TEMP_USER_PROGRESS(tempId);
      const tempProgress = await this.firebaseClient.getRawPath(tempProgressPath);
      
      if (tempProgress && Object.keys(tempProgress).length > 0) {
        // Copy progress to permanent user
        const permanentProgressPath = THEMES_DB_PATHS.USER_PROGRESS(permanentUserId);
        await this.firebaseClient.setRawPath(permanentProgressPath, {
          ...tempProgress,
          userId: permanentUserId,
          userType: 'logged_in',
          migratedFrom: tempId,
          migratedAt: Date.now()
        });

        logger.info(`Migrated temporary user progress: ${tempId} -> ${permanentUserId}`);
      }

      // Migrate attempts (more complex - need to update user IDs in attempts)
      await this.migrateUserAttempts(tempId, permanentUserId);

      // Clean up temporary user data
      await this.cleanupExpiredUser(tempId);

      return true;
    } catch (error) {
      logger.error(`Failed to migrate temporary user ${tempId} to ${permanentUserId}:`, error);
      return false;
    }
  }

  /**
   * Migrate user attempts from temporary to permanent user
   */
  private async migrateUserAttempts(tempId: string, permanentUserId: string): Promise<void> {
    try {
      const currentDate = getCurrentDateString();
      const tempAttemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(tempId, currentDate);
      const tempAttempts = await this.firebaseClient.getRawPath(tempAttemptsPath);

      if (tempAttempts && Object.keys(tempAttempts).length > 0) {
        const permanentAttemptsPath = THEMES_DB_PATHS.USER_ATTEMPTS(permanentUserId, currentDate);
        
        // Update user IDs in attempt records
        const migratedAttempts: Record<string, any> = {};
        for (const [attemptId, attemptData] of Object.entries(tempAttempts)) {
          if (attemptData && typeof attemptData === 'object') {
            migratedAttempts[attemptId] = {
              ...attemptData,
              userId: permanentUserId,
              userType: 'logged_in',
              originalTempId: tempId
            };
          }
        }

        await this.firebaseClient.setRawPath(permanentAttemptsPath, migratedAttempts);
        logger.debug(`Migrated ${Object.keys(migratedAttempts).length} attempts from ${tempId} to ${permanentUserId}`);
      }
    } catch (error) {
      logger.error(`Failed to migrate attempts from ${tempId} to ${permanentUserId}:`, error);
      // Don't throw - migration can continue without attempts
    }
  }

  /**
   * Clean up expired temporary user data
   */
  async cleanupExpiredUser(tempId: string): Promise<void> {
    try {
      // Remove temporary user record
      const tempUserPath = THEMES_DB_PATHS.TEMP_USER(tempId);
      await this.firebaseClient.removeRawPath(tempUserPath);

      // Remove temporary user progress
      const tempProgressPath = THEMES_DB_PATHS.TEMP_USER_PROGRESS(tempId);
      await this.firebaseClient.removeRawPath(tempProgressPath);

      // Note: We keep attempts for analytics even after temp user cleanup
      // They can be cleaned up separately by date-based cleanup jobs

      logger.debug(`Cleaned up expired temporary user: ${tempId}`);
    } catch (error) {
      logger.error(`Failed to cleanup temporary user ${tempId}:`, error);
      // Don't throw - cleanup failures shouldn't break user flow
    }
  }

  /**
   * Batch cleanup of all expired temporary users
   * Called by background job
   */
  async cleanupAllExpiredUsers(): Promise<{ cleaned: number; errors: number }> {
    let cleaned = 0;
    let errors = 0;

    try {
      const allTempUsers = await this.firebaseClient.getRawPath(THEMES_DB_PATHS.TEMP_USERS);
      
      if (!allTempUsers) {
        logger.debug('No temporary users found for cleanup');
        return { cleaned: 0, errors: 0 };
      }

      const tempUserIds = Object.keys(allTempUsers);
      logger.info(`Starting cleanup of ${tempUserIds.length} temporary users`);

      for (const tempId of tempUserIds) {
        try {
          const userData = allTempUsers[tempId] as TemporaryUserId;
          
          if (isTempUserExpired(userData.createdAt)) {
            await this.cleanupExpiredUser(tempId);
            cleaned++;
          }
        } catch (error) {
          logger.error(`Failed to cleanup temporary user ${tempId}:`, error);
          errors++;
        }
      }

      logger.info(`Temporary user cleanup completed: ${cleaned} cleaned, ${errors} errors`);
      return { cleaned, errors };
    } catch (error) {
      logger.error('Failed to perform batch cleanup of temporary users:', error);
      return { cleaned, errors: errors + 1 };
    }
  }

  /**
   * Get statistics about temporary users
   */
  async getTempUserStats(): Promise<{
    total: number;
    active: number;
    expired: number;
    oldestCreatedAt: number | null;
  }> {
    try {
      const allTempUsers = await this.firebaseClient.getRawPath(THEMES_DB_PATHS.TEMP_USERS);
      
      if (!allTempUsers) {
        return { total: 0, active: 0, expired: 0, oldestCreatedAt: null };
      }

      const users = Object.values(allTempUsers) as TemporaryUserId[];
      const now = Date.now();
      
      let active = 0;
      let expired = 0;
      let oldestCreatedAt: number | null = null;

      for (const user of users) {
        if (isTempUserExpired(user.createdAt)) {
          expired++;
        } else {
          active++;
        }

        if (oldestCreatedAt === null || user.createdAt < oldestCreatedAt) {
          oldestCreatedAt = user.createdAt;
        }
      }

      return {
        total: users.length,
        active,
        expired,
        oldestCreatedAt
      };
    } catch (error) {
      logger.error('Failed to get temporary user statistics:', error);
      return { total: 0, active: 0, expired: 0, oldestCreatedAt: null };
    }
  }
}