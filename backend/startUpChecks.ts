import { LoggedDatabaseClient } from "./db/LoggedDatabaseClient.js";
import logger from './logger.js';
import { migrate } from './migrate.js';
import { sendStartupEmails, EMAIL_VERSIONS_CONTENT } from './startupMailer.js';
import { investigateVectorDiscrepancy } from './investigate-vectors.js';

// --- Configuration ---
const LATEST_SUPPORTED_MAIL_VERSION = "1"; // The version currently rolled out to all users
const IS_TESTING_NEW_MAIL_VERSION = false; // Set to true to test the next version
const TEST_EMAIL_RECIPIENT = "admin@aphori.st"; // Email address for testing

// --- Startup Email Processing --- 

interface MailerVersionState {
    needsProcessing: boolean;
    targetVersion: string;
    currentStateDescription: string | null;
    processedEmails: string[];
}

/**
 * Checks the database version and runs migrations if necessary.
 * Exits the process if essential version checks or migrations fail.
 * @param db The database client instance.
 */
export async function checkAndRunMigrations(db: LoggedDatabaseClient): Promise<void> {
    logger.info('Checking database version for migration status...');
    let shouldRunMigration = false;

    try {
        const dbVersionInfo = await db.getDatabaseVersion(); 
        shouldRunMigration = determineIfMigrationNeeded(dbVersionInfo);
    } catch (e: any) { 
        handleFatalError(
            `FATAL: Could not check for 'databaseVersion' key. Server cannot safely determine migration status.`, 
            e
        );
    }

    if (shouldRunMigration) {
        await executeMigration(db);
    } else {
        logger.info("Skipping data migration based on database version check.");
    }

    // Always run vector investigation after migration check
    try {
        logger.info("Running vector discrepancy investigation...");
        await investigateVectorDiscrepancy(db);
    } catch (error: any) {
        logger.error("Vector investigation failed:", error);
        // Don't fail startup for investigation issues
    }
}

function determineIfMigrationNeeded(dbVersionInfo: any): boolean {
    if (dbVersionInfo === null || dbVersionInfo === undefined) {
        logger.info(`No 'databaseVersion' key found. Migration will be skipped.`);
        return false;
    } else if (dbVersionInfo === "3") {
        // Database is at version 3, need to run vector embedding backfill migration to version 4
        logger.info(`'databaseVersion' is "3". Performing vector embedding backfill migration to version 4.`);
        return true;
    } else if (dbVersionInfo === "3->4") {
        // Migration was interrupted during transition - retry from where it left off
        logger.info(`'databaseVersion' is "3->4" (transition state). Retrying vector embedding backfill migration to version 4.`);
        return true;
    } else if (typeof dbVersionInfo === 'object' && dbVersionInfo !== null && 
               'status' in dbVersionInfo && dbVersionInfo.status === "failed_vector_migration") {
        // Previous migration failed - retry the migration
        logger.warn(`Previous vector migration failed. Retrying migration from version ${dbVersionInfo.fromVersion} to ${dbVersionInfo.toVersion}. Previous error: ${dbVersionInfo.error}`);
        return true;
    } else {
        logger.info(`'databaseVersion' found. Value: ${JSON.stringify(dbVersionInfo)}. Migration will be skipped.`);
        return false;
    }
}

async function executeMigration(db: LoggedDatabaseClient): Promise<void> {
    try {
        logger.info(`Proceeding with data migration...`);
        await migrate(db); // Assumes migrate.ts handles setting the new version on success/failure
        logger.info('Data migration completed successfully.');
    } catch (migrationError) {
        handleFatalError("FATAL: Data migration failed during execution.", migrationError);
    }
}

/**
 * Processes startup emails based on the mailer version stored in the database.
 * Sends emails to users who haven't received the latest version supported by the server.
 * @param db The database client instance.
 */
export async function processStartupEmails(db: LoggedDatabaseClient): Promise<void> {
    logger.info("Checking for startup email tasks...");

    try {
        const allUserEmails = await getAllUserEmailsFromDb(db);
        if (!allUserEmails || allUserEmails.length === 0) {
            logger.info("No users found. Skipping startup email process.");
            return;
        }

        const versionState = await determineMailerVersionState(db);

        if (versionState.needsProcessing && EMAIL_VERSIONS_CONTENT[versionState.targetVersion]) {
            logger.info(`Processing startup emails. Target version: ${versionState.targetVersion}${IS_TESTING_NEW_MAIL_VERSION ? ' (TESTING MODE - admin only)' : ''}. DB state: ${versionState.currentStateDescription}.`);
            
            const processedEmailsAfterRun = await sendEmailsToUnprocessedUsers(db, allUserEmails, versionState.processedEmails, versionState.targetVersion);
            
            await finalizeMailerVersionIfNeeded(db, allUserEmails, processedEmailsAfterRun, versionState.targetVersion);

        } else if (versionState.needsProcessing) {
            // Needs processing but content is missing for the target version
            logger.error(`Cannot process startup emails: No email content defined for target mail version ${versionState.targetVersion}. DB state: ${versionState.currentStateDescription}${IS_TESTING_NEW_MAIL_VERSION ? ' (TESTING MODE)' : ''}`);
        }
        // If !versionState.needsProcessing, logging is handled within determineMailerVersionState

    } catch (emailError: any) {
        handleNonFatalError("Error during startup email processing. This will not halt server startup.", emailError);
    }
}

async function getAllUserEmailsFromDb(db: LoggedDatabaseClient): Promise<string[]> {
     const allUsersData = await db.getAllUsers(); 
     return allUsersData 
         ? Object.values(allUsersData).map((user: any) => user.email).filter(email => !!email) 
         : [];
}

async function getProcessedEmailsList(db: LoggedDatabaseClient): Promise<string[]> {
    const mailSentMap = await db.getMailSentListMap();
    if (!mailSentMap) return [];

    const keys = Object.keys(mailSentMap);
    // Safely unescape keys
    return keys.map(key => db.unescapeFirebaseKeyPercentEncoding(key))
               .filter((key): key is string => key !== null);
}

async function determineMailerVersionState(db: LoggedDatabaseClient): Promise<MailerVersionState> {
    const currentDbVersion = await db.getMailerVersion();
    const processedEmails = await getProcessedEmailsList(db);
    let state: MailerVersionState = {
        needsProcessing: false,
        targetVersion: "",
        currentStateDescription: currentDbVersion,
        processedEmails: processedEmails,
    };

    if (currentDbVersion === null) {
        // Initial state: No version set. Start transition towards the latest supported version.
        logger.info(`No mailer version found. Initializing transition for version ${LATEST_SUPPORTED_MAIL_VERSION}${IS_TESTING_NEW_MAIL_VERSION ? ' (TESTING MODE)' : ''}.`);
        state.currentStateDescription = `0->${LATEST_SUPPORTED_MAIL_VERSION}`;
        await db.setMailerVersion(state.currentStateDescription);
        // Initialize list only if NOT testing
        if (!IS_TESTING_NEW_MAIL_VERSION) {
            logger.info(`Initializing mailSentList for transition: ${state.currentStateDescription}`);
            await db.initializeMailSentList();
            state.processedEmails = []; // Reset list
        } else {
            logger.info(`TESTING MODE: Preserving mailSentList during initial transition.`);
        }
        state.targetVersion = LATEST_SUPPORTED_MAIL_VERSION;
        state.needsProcessing = true;
    } else if (currentDbVersion.includes('->')) {
        // Transitional state: e.g., "0->1"
        const parts = currentDbVersion.split('->');
        const dbTargetVersion = parts[1];
        logger.info(`Mailer version is in transition: ${currentDbVersion}${IS_TESTING_NEW_MAIL_VERSION ? ' (TESTING MODE)' : ''}.`);
        
        // Check if the DB target version is supported by the server
        if (parseInt(dbTargetVersion) <= parseInt(LATEST_SUPPORTED_MAIL_VERSION)) {
            state.targetVersion = dbTargetVersion;
            state.needsProcessing = true;
        } else {
            logger.warn(`Database mailer version ${currentDbVersion} targets ${dbTargetVersion}, but server only supports up to ${LATEST_SUPPORTED_MAIL_VERSION}${IS_TESTING_NEW_MAIL_VERSION ? ' (TESTING MODE)' : ''}. Skipping.`);
            state.needsProcessing = false;
        }
    } else { // Final state: Version is a number string, e.g., "0"
        const currentVersionInt = parseInt(currentDbVersion);
        const latestSupportedVersionInt = parseInt(LATEST_SUPPORTED_MAIL_VERSION);

        if (currentVersionInt < latestSupportedVersionInt) {
            // DB version is lower than what the server supports.
            logger.info(`Current mailer version ${currentDbVersion} is less than server target ${LATEST_SUPPORTED_MAIL_VERSION}${IS_TESTING_NEW_MAIL_VERSION ? ' (TESTING MODE)' : ''}. Starting transition.`);
            state.currentStateDescription = `${currentDbVersion}->${LATEST_SUPPORTED_MAIL_VERSION}`;
            
            // Set the transition state in DB
            await db.setMailerVersion(state.currentStateDescription); 
            
            // Initialize list only if NOT testing
            if (!IS_TESTING_NEW_MAIL_VERSION) {
                 logger.info(`Initializing mailSentList for transition: ${state.currentStateDescription}`);
                 await db.initializeMailSentList();
                 state.processedEmails = []; // Reset list for full rollout
            } else {
                 logger.info(`TESTING MODE: Preserving mailSentList during transition from ${currentDbVersion}.`);
                 // Use existing processedEmails list loaded earlier
            }
            
            state.targetVersion = LATEST_SUPPORTED_MAIL_VERSION;
            state.needsProcessing = true;

        } else {
            // DB version is up-to-date or newer than the server target
            logger.info(`Mailer version ${currentDbVersion} is up-to-date with or newer than server target ${LATEST_SUPPORTED_MAIL_VERSION}${IS_TESTING_NEW_MAIL_VERSION ? ' (TESTING MODE)' : ''}. No startup emails needed.`);
            state.needsProcessing = false;
        }
    }
    return state;
}

async function sendEmailsToUnprocessedUsers(
    db: LoggedDatabaseClient, 
    allUserEmails: string[], 
    processedEmails: string[],
    targetVersion: string
): Promise<string[]> { // Returns the updated list of processed emails
    
    // Determine the list of users to consider based on testing mode
    const effectiveUserList = IS_TESTING_NEW_MAIL_VERSION ? [TEST_EMAIL_RECIPIENT] : allUserEmails;
    const logSuffix = IS_TESTING_NEW_MAIL_VERSION ? ` (TESTING MODE: targeting only ${TEST_EMAIL_RECIPIENT})` : '';

    const usersToEmail = effectiveUserList.filter(email => email && !processedEmails.includes(email));
    let updatedProcessedEmails = [...processedEmails]; // Start with current list

    if (usersToEmail.length > 0) {
        logger.info(`Found ${usersToEmail.length} users to email for version ${targetVersion}${logSuffix}.`);
        const successfullySentTo = await sendStartupEmails(db, usersToEmail, targetVersion);
        updatedProcessedEmails = updatedProcessedEmails.concat(successfullySentTo);
    } else {
        logger.info(`No new users to email for version ${targetVersion}${logSuffix}.`);
    }
    return updatedProcessedEmails;
}

async function finalizeMailerVersionIfNeeded(
    db: LoggedDatabaseClient, 
    allUserEmails: string[], 
    finalProcessedEmails: string[],
    targetVersion: string
): Promise<void> {

    // ** Skip finalization if in testing mode **
    if (IS_TESTING_NEW_MAIL_VERSION) {
        // Log status of test recipient, useful for debugging
        const testUserProcessed = finalProcessedEmails.includes(TEST_EMAIL_RECIPIENT);
        logger.info(`TESTING MODE: Skipping finalization for version ${targetVersion}. Test recipient (${TEST_EMAIL_RECIPIENT}) processed status: ${testUserProcessed}.`);
        return;
    }

    // Original logic for non-testing mode:
    // Check if all known users are now processed for this target version
    const allProcessed = allUserEmails.every(email => finalProcessedEmails.includes(email));

    if (allProcessed) {
        logger.info(`All ${allUserEmails.length} users processed for mail version ${targetVersion}. Finalizing version.`);
        await db.setMailerVersion(targetVersion);
        await db.clearMailSentList();
        logger.info(`Mailer version updated to ${targetVersion} and mailSentList cleared.`);
    } else {
         const remainingCount = allUserEmails.length - finalProcessedEmails.length;
         logger.info(`Still ${remainingCount} users remaining for mail version ${targetVersion}. Will continue on next startup.`);
    }
}

// --- Utility Functions ---

function handleFatalError(message: string, error: any): void {
    if (error instanceof Error) {
        logger.fatal({ err: error, errorMessage: error.message }, message);
    } else {
        logger.fatal({ errContext: String(error) }, message);
    }
    process.exit(1); 
}

function handleNonFatalError(message: string, error: any): void {
     if (error instanceof Error) {
        logger.error({ err: error, errorMessage: error.message }, message);
    } else {
        logger.error({ errContext: String(error) }, message);
    }
} 