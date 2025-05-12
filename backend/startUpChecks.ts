import { LoggedDatabaseClient } from "./db/LoggedDatabaseClient.js";
import logger from './logger.js';
import { migrate } from './migrate.js';
import { sendStartupEmails, EMAIL_VERSIONS_CONTENT } from './startupMailer.js';

// Define constants for database keys to avoid magic strings
const LATEST_SUPPORTED_MAIL_VERSION = "1";

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
}

function determineIfMigrationNeeded(dbVersionInfo: any): boolean {
    if (dbVersionInfo === null || dbVersionInfo === undefined) {
        logger.info(`No 'databaseVersion' key found. Migration will be skipped.`);
        return false;
    } else if (typeof dbVersionInfo === 'object' && dbVersionInfo !== null && 
               'migrationComplete' in dbVersionInfo && dbVersionInfo.migrationComplete === true && 
               'current' in dbVersionInfo && dbVersionInfo.current === "2") {
        // This condition specifically checks if version "2" migration IS complete,
        // implying we should run the *next* migration (which is migrate.ts aiming for v3)
        logger.info(`'databaseVersion' indicates version 2 is complete. Performing migration to version 3.`);
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
            logger.info(`Processing startup emails for target version ${versionState.targetVersion} (DB state: ${versionState.currentStateDescription}).`);
            
            const processedEmailsAfterRun = await sendEmailsToUnprocessedUsers(db, allUserEmails, versionState.processedEmails, versionState.targetVersion);
            
            await finalizeMailerVersionIfNeeded(db, allUserEmails, processedEmailsAfterRun, versionState.targetVersion);

        } else if (versionState.needsProcessing) {
            // Needs processing but content is missing for the target version
            logger.error(`Cannot process startup emails: No email content defined for target mail version ${versionState.targetVersion}. DB state: ${versionState.currentStateDescription}`);
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
        logger.info(`No mailer version found. Initializing for version ${LATEST_SUPPORTED_MAIL_VERSION}.`);
        state.currentStateDescription = `0->${LATEST_SUPPORTED_MAIL_VERSION}`;
        await db.setMailerVersion(state.currentStateDescription);
        await db.initializeMailSentList();
        state.processedEmails = []; // Reset list
        state.targetVersion = LATEST_SUPPORTED_MAIL_VERSION;
        state.needsProcessing = true;
    } else if (currentDbVersion.includes('->')) {
        const parts = currentDbVersion.split('->');
        const dbTargetVersion = parts[1];
        logger.info(`Mailer version is in transition: ${currentDbVersion}.`);
        if (parseInt(dbTargetVersion) <= parseInt(LATEST_SUPPORTED_MAIL_VERSION)) {
            state.targetVersion = dbTargetVersion;
            state.needsProcessing = true;
        } else {
            logger.warn(`Database mailer version ${currentDbVersion} targets ${dbTargetVersion}, but server only supports up to ${LATEST_SUPPORTED_MAIL_VERSION}. Skipping.`);
            state.needsProcessing = false;
        }
    } else { // Version is a final number string
        if (parseInt(currentDbVersion) < parseInt(LATEST_SUPPORTED_MAIL_VERSION)) {
            logger.info(`Current mailer version ${currentDbVersion} is less than server target ${LATEST_SUPPORTED_MAIL_VERSION}. Starting transition.`);
            state.currentStateDescription = `${currentDbVersion}->${LATEST_SUPPORTED_MAIL_VERSION}`;
            await db.setMailerVersion(state.currentStateDescription);
            await db.initializeMailSentList();
            state.processedEmails = []; // Reset list
            state.targetVersion = LATEST_SUPPORTED_MAIL_VERSION;
            state.needsProcessing = true;
        } else {
            logger.info(`Mailer version ${currentDbVersion} is up-to-date with or newer than server target ${LATEST_SUPPORTED_MAIL_VERSION}. No startup emails needed.`);
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
    const usersToEmail = allUserEmails.filter(email => !processedEmails.includes(email));
    let updatedProcessedEmails = [...processedEmails]; // Start with current list

    if (usersToEmail.length > 0) {
        logger.info(`Found ${usersToEmail.length} users to email for version ${targetVersion}.`);
        const successfullySentTo = await sendStartupEmails(db, usersToEmail, targetVersion);
        updatedProcessedEmails = updatedProcessedEmails.concat(successfullySentTo);
    } else {
        logger.info(`No new users to email for version ${targetVersion}.`);
    }
    return updatedProcessedEmails;
}

async function finalizeMailerVersionIfNeeded(
    db: LoggedDatabaseClient, 
    allUserEmails: string[], 
    finalProcessedEmails: string[],
    targetVersion: string
): Promise<void> {
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