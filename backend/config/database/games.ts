/**
 * Database configuration and path utilities for games
 */

import { THEMES_DB_PATHS, THEMES_CONFIG } from '../../types/games/themes.js';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Generate a unique temporary user ID
 */
export function generateTempUserId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `temp_${timestamp}_${random}`;
}

/**
 * Generate a unique attempt ID
 */
export function generateAttemptId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `attempt_${timestamp}_${random}`;
}

/**
 * Generate a unique puzzle ID
 */
export function generatePuzzleId(date: string, puzzleNumber: number): string {
  return `${date}_puzzle_${puzzleNumber}`;
}

/**
 * Get current date in YYYY-MM-DD format
 */
export function getCurrentDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Check if temporary user ID has expired
 */
export function isTempUserExpired(createdAt: number): boolean {
  const expiryTime = createdAt + (THEMES_CONFIG.TEMP_USER_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  return Date.now() > expiryTime;
}

/**
 * Calculate expiry timestamp for temporary user
 */
export function calculateTempUserExpiry(createdAt: number): number {
  return createdAt + (THEMES_CONFIG.TEMP_USER_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Validate puzzle completion based on attempts
 * Returns true if the user has successfully completed all categories
 */
export function isPuzzleCompleted(attempts: any[], totalCategories: number): boolean {
  const correctAttempts = attempts.filter(attempt => attempt.result === 'correct');
  const uniqueCompletedCategories = new Set(correctAttempts.map(attempt => attempt.categoryId));
  return uniqueCompletedCategories.size >= totalCategories;
}

/**
 * Get next puzzle index for user progression
 * Users must complete puzzles sequentially
 */
export function getNextAvailablePuzzle(completedPuzzles: string[], currentDate: string): number {
  const todayPuzzles = completedPuzzles.filter(puzzleId => puzzleId.startsWith(currentDate));
  return todayPuzzles.length; // 0-based index, so length = next available
}

/**
 * Check if user can access a specific puzzle
 * Puzzles must be completed in order
 */
export function canAccessPuzzle(puzzleNumber: number, completedPuzzles: string[], currentDate: string): boolean {
  const todayCompleted = completedPuzzles.filter(puzzleId => puzzleId.startsWith(currentDate)).length;
  return puzzleNumber <= todayCompleted + 1; // Can access next puzzle after completing current one
}

/**
 * Generate emoji pattern for shareable results
 * Uses different emojis to represent attempt results
 */
export function generateEmojiPattern(attempts: any[]): string[] {
  const emojiMap = {
    correct: '🟩',
    one_away: '🟨',
    two_away: '🟧',
    three_away: '🟥',
    far_away: '⬜'
  };

  // Handle edge cases: null, undefined, or empty arrays
  if (!attempts || !Array.isArray(attempts) || attempts.length === 0) {
    return [];
  }

  return attempts.map(attempt => {
    // Handle invalid attempt objects
    if (!attempt || typeof attempt !== 'object') {
      return emojiMap.far_away;
    }

    // Handle correct result
    if (attempt.result === 'correct') {
      return emojiMap.correct;
    }
    
    // Handle distance-based results with bounds checking
    const distance = attempt.distance;
    if (typeof distance !== 'number' || !Number.isInteger(distance) || distance < 0) {
      return emojiMap.far_away;
    }

    switch (distance) {
      case 1: return emojiMap.one_away;
      case 2: return emojiMap.two_away;
      case 3: return emojiMap.three_away;
      default: return emojiMap.far_away;
    }
  });
}

/**
 * Database transaction helper for atomic operations
 * Useful for updating user progress and storing attempts simultaneously
 */
export interface ThemesGameTransaction {
  updateUserProgress: {
    path: string;
    data: any;
  };
  storeAttempt: {
    path: string;
    data: any;
  };
  incrementCounters?: {
    path: string;
    increment: number;
  }[];
}

/**
 * Validate database paths to prevent injection attacks
 */
export function validateDatabasePath(path: string): boolean {
  // Basic type and null/undefined checks
  if (typeof path !== 'string' || path == null) {
    return false;
  }
  
  // Length validation to prevent excessively long paths
  if (path.length === 0 || path.length > 500) {
    return false;
  }
  
  // Prevent path traversal attempts
  if (path.includes('..') || path.includes('./') || path.includes('../')) {
    return false;
  }
  
  // Prevent multiple consecutive slashes which could bypass filters
  if (path.includes('//') || path.includes('///')) {
    return false;
  }
  
  // Prevent paths starting or ending with slash (except single slash)
  if (path.startsWith('/') || path.endsWith('/')) {
    return false;
  }
  
  // Prevent encoded characters that could bypass validation
  if (path.includes('%') || path.includes('\\u') || path.includes('\\x')) {
    return false;
  }
  
  // Prevent null bytes and other control characters
  // eslint-disable-next-line no-control-regex
  if (path.includes('\0') || /[\x00-\x1f\x7f-\x9f]/.test(path)) {
    return false;
  }
  
  // Normalize Unicode to prevent homograph attacks in paths
  const normalizedPath = path.normalize('NFKC');
  if (normalizedPath !== path) {
    return false;
  }
  
  // Only allow alphanumeric, hyphens, underscores, and forward slashes
  const validPathRegex = /^[a-zA-Z0-9\-_/]+$/;
  if (!validPathRegex.test(path)) {
    return false;
  }
  
  // Additional validation: ensure path segments are reasonable
  const segments = path.split('/');
  for (const segment of segments) {
    // Empty segments (consecutive slashes) already caught above
    // Check for reserved names or suspicious patterns
    if (segment.length > 100) { // Individual segment too long
      return false;
    }
    
    // Prevent common injection patterns in path segments
    if (segment.includes('__') || segment.startsWith('_') || segment.endsWith('_')) {
      return false;
    }
    
    // Prevent segments that could be confused with database operations
    const reservedSegments = ['admin', 'root', 'system', 'config', 'meta', 'index'];
    if (reservedSegments.includes(segment.toLowerCase())) {
      return false;
    }
  }
  
  return true;
}

/**
 * Sanitize user input for database storage
 * Uses DOMPurify to remove XSS vectors and other potentially dangerous content
 */
export function sanitizeUserInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  // First trim the input
  let sanitized = input.trim();
  
  // Use DOMPurify to sanitize HTML/XSS vectors
  // Configure to be very restrictive - strip all HTML tags and scripts
  sanitized = DOMPurify.sanitize(sanitized, {
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: [], // No attributes allowed
    KEEP_CONTENT: true, // Keep text content when removing tags
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit']
  });
  
  // Additional character filtering for database safety
  // Remove/replace dangerous characters that could cause issues in database queries
  // Use a safer approach to filter out control characters without raw escape sequences
  sanitized = sanitized
    .split('')
    .filter(char => {
      const code = char.charCodeAt(0);
      // Remove control characters (0-31 and 127-159) but keep printable characters
      if ((code >= 0 && code <= 31) || (code >= 127 && code <= 159)) {
        return false;
      }
      return true;
    })
    .join('')
    .replace(/\\/g, '') // Remove backslashes to prevent escape sequence issues
    .replace(/[`${}]/g, '') // Remove template literal and object notation characters
    .normalize('NFKC'); // Unicode normalization to prevent homograph attacks
  
  // Final length limitation
  return sanitized.substring(0, 1000);
}

export { THEMES_DB_PATHS, THEMES_CONFIG };