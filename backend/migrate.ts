import logger from './logger.js';
import { FirebaseClient } from './db/FirebaseClient.js';
import { LoggedDatabaseClient } from './db/LoggedDatabaseClient.js';

// pako would be needed if oldDataContainer.c could be true and meant pako compression
// import pako from 'pako';

interface OldUserEmailValue {
    v: number;
    c: boolean; // compression flag
    d: string;  // base64 encoded JSON string of the user ID
}

interface NewUser {
    id: string;
    email: string;
    createdAt: string;
}

async function migrateUsersData(dbClient: LoggedDatabaseClient, firebaseClientInstance: FirebaseClient): Promise<void> {
    logger.info('Starting User Data Migration Process...');
    let migratedUserCount = 0;
    let failedUserCount = 0;

    const rootData = await firebaseClientInstance.readPath('/');
    if (!rootData || typeof rootData !== 'object') {
        logger.warn('No data found at database root or data is not an object. Cannot migrate users.');
        return;
    }

    const oldEmailKeys = Object.keys(rootData).filter(key => key.startsWith('email_to_id:'));

    if (oldEmailKeys.length === 0) {
        logger.info('No old user email_to_id keys found (e.g., starting with "email_to_id:"). User migration skipped.');
        return;
    }

    logger.info(`Found ${oldEmailKeys.length} old user email_to_id keys to migrate.`);

    for (const oldEmailKey of oldEmailKeys) {
        try {
            const rawJsonString = rootData[oldEmailKey];
            if (typeof rawJsonString !== 'string') {
                logger.warn(`Value for key ${oldEmailKey} is not a string. Skipping. Value: ${JSON.stringify(rawJsonString)}`);
                failedUserCount++;
                continue;
            }

            const oldDataContainer: OldUserEmailValue = JSON.parse(rawJsonString);

            let actualUserId: string;
            // The 'd' field is a Base64 encoded JSON string (e.g., "Admin", "arock")
            const base64DecodedJsonStringUserId = Buffer.from(oldDataContainer.d, 'base64').toString('utf8');

            if (oldDataContainer.c === true) {
                // If c:true truly meant pako compression, this would be:
                // const compressedPayload = Buffer.from(oldDataContainer.d, 'base64');
                // const jsonStringUserId = pako.inflate(compressedPayload, { to: 'string' });
                // actualUserId = JSON.parse(jsonStringUserId);
                logger.warn(`Compression flag 'c' is true for ${oldEmailKey}. Pako decompression for 'c:true' is not implemented in this script. Proceeding as if 'd' is base64 of JSON string UserID.`);
                actualUserId = JSON.parse(base64DecodedJsonStringUserId);
            } else {
                // c:false means 'd' is base64 of JSON string UserID
                actualUserId = JSON.parse(base64DecodedJsonStringUserId);
            }

            if (!actualUserId || typeof actualUserId !== 'string' || actualUserId.trim() === '') {
                logger.error(`Could not extract a valid user ID for key ${oldEmailKey}. Decoded ID: '${actualUserId}'. Skipping.`);
                failedUserCount++;
                continue;
            }

            // Extract and clean email from the old key structure
            // Old key: "email_to_id:some_email_with_underscores"
            const emailPartInKey = oldEmailKey.substring('email_to_id:'.length);
            const actualEmail = emailPartInKey.replace(/_/g, '.'); // Replace underscore with dot

            const newUser: NewUser = {
                id: actualUserId, // This is the old string ID (e.g., "Admin", "Max")
                email: actualEmail.toLowerCase(), // Store email consistently in lowercase
                createdAt: new Date().toISOString(), // No old timestamp available in this data
            };

            if (!newUser.id || !newUser.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newUser.email)) {
                 logger.error(`Invalid user object created for old key ${oldEmailKey}. Data: ${JSON.stringify(newUser)}. Skipping.`);
                 failedUserCount++;
                 continue;
            }

            // --- Write to new paths based on backend_architecture.md ---

            // 1. User data: /users/{userId}
            await dbClient.setUserDataForMigration(newUser.id, newUser);

            // 2. Email to ID mapping: /userMetadata/emailToId/{escapedActualEmail}
            await dbClient.setEmailToIdMapping(newUser.email, newUser.id);

            // 3. User ID set: /userMetadata/userIds/{userId} = true
            await dbClient.addUserToCatalog(newUser.id);

            // 4. Delete old entry from root
            await dbClient.deleteOldEmailToIdKey(oldEmailKey);

            logger.info(`Successfully migrated user ID '${newUser.id}' (Email: ${newUser.email}) from old key '${oldEmailKey}'.`);
            migratedUserCount++;

        } catch (error: any) {
            logger.error(`Failed to migrate user data for old key ${oldEmailKey}: ${error.message}`, { err: error, keyDetails: oldEmailKey });
            failedUserCount++;
        }
    }
    logger.info(`User data migration process finished. Successfully migrated: ${migratedUserCount}, Failed: ${failedUserCount}`);
    if (failedUserCount > 0) {
        throw new Error(`User migration completed with ${failedUserCount} failures.`);
    }
}

export async function migrate(dbClient: LoggedDatabaseClient): Promise<void> {
    logger.info('Starting Data Migration Script (User Data Migration Stage)...');
    let firebaseClientInstance: FirebaseClient;
    const previousVersion = "2"; // Assuming posts migration was version "2"
    const targetVersion = "3";
    

    try {
        // Obtain FirebaseClient instance (required for direct path operations like root listing and old key deletion)
        if (dbClient instanceof FirebaseClient) {
            firebaseClientInstance = dbClient;
        } else if (dbClient instanceof LoggedDatabaseClient && (dbClient as LoggedDatabaseClient).getUnderlyingClient() instanceof FirebaseClient) {
            firebaseClientInstance = (dbClient as LoggedDatabaseClient).getUnderlyingClient() as unknown as FirebaseClient;
        } else {
            throw new Error("Migration requires a raw FirebaseClient instance for some operations. Could not obtain one from the provided dbClient.");
        }
        logger.info("Obtained FirebaseClient instance for migration.");

        await dbClient.connect().catch(err => {
            logger.error("Migration: Initial DB connection failed.", { err });
            throw err;
        });
        logger.info("Database client connected for user migration.");
        
        try {
            await dbClient.setDatabaseVersion("2->3");
            logger.info(`Database version set to: "2->3"`);
        } catch (dbVersionError: any) {
            logger.warn({ err: dbVersionError }, "Failed to set initial pending databaseVersion for user migration. Proceeding, but status tracking might be affected.");
        }

        // Call the actual user data migration logic
        await migrateUsersData(dbClient as LoggedDatabaseClient, firebaseClientInstance);

        await dbClient.setDatabaseVersion("3");
        logger.info(`User migration script completed successfully. DatabaseVersion updated to: "3"`);

    } catch (err: any) {
        logger.error('User migration script encountered a fatal error:', { err });
        const failureVersionInfo = { 
            current: `${targetVersion}_failed`, 
            fromVersion: previousVersion, 
            toVersion: targetVersion, 
            status: "failed_user_migration", 
            error: err.message,
            timestamp: new Date().toISOString()
        };
        try {
            await dbClient.setDatabaseVersion(failureVersionInfo);
            logger.info(`Database version updated to reflect user migration failure: ${JSON.stringify(failureVersionInfo)}`);
        } catch (dbVersionError: any) {
             logger.error({ err: dbVersionError }, "CRITICAL: FAILED to set databaseVersion after user migration script error. Manual check required.");
        }
        throw err; // Re-throw the error to indicate script failure
    } finally {
        logger.info("User migration script execution finished.");
    }
}
