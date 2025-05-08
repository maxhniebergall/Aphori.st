/* requirements
- getUserById checks id with tolowercase
- Accepts development token in non-production environments
- Handles quote metadata in post creation and retrieval
- Stores quote data with source post ID and selection range
- Creates posts (postTrees) with new schema structure separating posts from replies
- Handles reply creation with quote references and parent tracking
- Creates formatted post trees with metadata and node structure
- Manages feed items for root-level posts only
- Supports retrieving individual replies by UUID
- Fetches replies by post UUID and quote
- Supports sorting replies by different criteria
- Provides API endpoints for getting replies by UUID, quote, and sorting criteria
- Supports reply feed retrieval sorted by recency
- Uses zAdd to maintain sorted sets for replies
- Handles null/empty responses from Firebase for zRange and zCard operations
- Maintains compatibility with both Redis and Firebase implementations
- Maintains quote reply counts using hash storage for efficient retrieval
- Reads old format of quote reply counts, migrates to new format, and replaces old format in database
- Implements combined node endpoint for unified node structure with backward compatibility and updated compression handling
- Provides API endpoint to retrieve quote reply counts for a given parent ID, returning CompressedApiResponse<ExistingSelectableQuotes>
*/

import express, { Request, Response, NextFunction } from "express";
import { createDatabaseClient } from './db/index.js';
import logger from './logger.js';
import cors from 'cors';
import dotenv from 'dotenv';
import compression from 'compression';
import * as fsSync from 'fs'; // Keep sync fs for existsSync
import { fileURLToPath } from 'url';
import path from 'path';
import { dirname } from 'path';
import requestLogger from './middleware/requestLogger.js';
import { optionalAuthMiddleware } from './middleware/optionalAuthMiddleware.js';
import { 
  loggedInLimiter, 
  anonymousLimiterMinute, 
  anonymousLimiterHour, 
  anonymousLimiterDay 
} from './middleware/rateLimitMiddleware.js';
import authRoutes, { setDb as setAuthDb } from './routes/auth.js';
import feedRoutes, { setDb as setFeedDb } from './routes/feed.js';
import postRoutes, { setDb as setPostDb } from './routes/posts.js';
import replyRoutes, { setDb as setReplyDb } from './routes/replies.js';
import { migrate } from './migrate.js';
import { LoggedDatabaseClient } from "./db/LoggedDatabaseClient.js";
import { sendStartupEmails, EMAIL_VERSIONS_CONTENT } from './startupMailer.js';

dotenv.config();

const PORT = process.env.PORT || 5050;

// Determine the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load build hash
let BUILD_HASH = 'development';
try {
    // Construct path relative to this file's directory
    const envBuildPath = path.join(__dirname, '../../.env.build'); 
    const buildEnv = fsSync.readFileSync(envBuildPath, 'utf8');
    BUILD_HASH = buildEnv.split('=')[1].trim();
    logger.info(`Loaded build hash: ${BUILD_HASH}`);
} catch (err) {
    logger.warn('No build hash found, using development');
}

const app = express();
app.use(express.json());

// Add the request logging middleware early
app.use(requestLogger);

// Add compression middleware
app.use(compression());

// Trust proxy - required for rate limiting behind Cloud Run
app.set('trust proxy', 1);

// Parse the CORS_ORIGIN environment variable into an array and merge with default origins
const defaultOrigins = [
  'https://aphorist.firebaseapp.com',
  'https://aphorist.web.app',
  'https://aphori.st',
  'https://www.aphori.st'
];

// Add development origins only in non-production
if (process.env.NODE_ENV !== 'production') {
  defaultOrigins.push('http://localhost:3000');
  defaultOrigins.push('http://localhost:5050');
}

// Parse CORS origins from environment variable
const envOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()) : [];
const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];

logger.info('Configured CORS origins: %O', allowedOrigins);

// Configure CORS using the official middleware
const corsOptions = {
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Frontend-Hash', 'cache-control', 'pragma', 'expires'],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200 // some legacy browsers (IE11, various SmartTVs) choke on 204
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Set build hash after CORS headers
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Build-Hash', BUILD_HASH);
  next();
});

// --- Apply Optional Authentication and Rate Limiting Middlewares ---
// This middleware attempts to identify the user from JWT for rate limiting purposes,
// but does not block unauthenticated requests.
app.use(optionalAuthMiddleware);

// Apply rate limiters. The 'skip' option within each limiter ensures
// that only the appropriate one (anonymous or logged-in) applies.
app.use(loggedInLimiter);
// Apply layered anonymous limiters in order of restrictiveness (minute, then hour, then day)
app.use(anonymousLimiterMinute);
app.use(anonymousLimiterHour);
app.use(anonymousLimiterDay);
// app.use(anonymousLimiter); // Comment out or remove the old single anonymous limiter
// --- End Optional Authentication and Rate Limiting Middlewares ---


// createDatabaseClient() now returns LoggedDatabaseClient
const db = createDatabaseClient();


let isDbReady = false;

// Database readiness check
app.use((req: Request, res: Response, next: NextFunction): void => {
    if (!isDbReady) {
        logger.warn('Database not ready, returning 503');
        res.status(503).json({ 
            error: 'Service initializing, please try again in a moment'
        });
        return;
    }
    next();
});

await db.connect().then(async () => { // Make the callback async
    logger.info('Database client connected');
    isDbReady = true;

    let runMigration = false; // Initialize to not run migration

    try {
        const databaseVersion = await db.get('databaseVersion'); // Attempt to get the database version
        if (databaseVersion === null || databaseVersion === undefined) {
            // If databaseVersion key does not exist, schedule migration
            logger.info("No 'databaseVersion' key found in the database. Migration will be skipped.");
            runMigration = false;
        } else if (databaseVersion.migrationComplete && databaseVersion.current === "2") {
            // If databaseVersion key exists and migrationComplete is true, perform the next migration
            logger.info(`Database version key 'databaseVersion' found. Value: ${JSON.stringify(databaseVersion)}. Performing next migration.`);
            runMigration = true;
        } else {
            // If databaseVersion key exists, log its presence and skip migration
            logger.info(`Database version key 'databaseVersion' found. Value: ${JSON.stringify(databaseVersion)}. Migration will be skipped.`);
            // runMigration remains false
        }
    } catch (e: any) { // MODIFIED CATCH BLOCK for robustness and to address linter issues
        const baseMessage = "FATAL: Could not check for 'databaseVersion' key. Server cannot safely determine migration status and will shut down.";
        if (e instanceof Error) {
            logger.fatal({ err: e, errorMessage: e.message }, baseMessage);
        } else {
            logger.fatal({ errContext: String(e) }, baseMessage);
        }
        process.exit(1); // Exit the process
    }

    // Conditionally run the migration based on the check above
    if (runMigration) {
        try {
            logger.info(`Proceeding with data migration as 'databaseVersion' key was not found...`);
            await migrate(db); // Execute the migration logic
            logger.info('Data migration completed successfully.');
            // IMPORTANT: Consider setting the 'databaseVersion' key here after a successful migration
            // to prevent it from running again on subsequent starts. For example:
            // await db.set('databaseVersion', 'current_version_identifier');
            // logger.info(`'databaseVersion' key set after successful migration.`);
        } catch (migrationError) {
            // If migration itself fails, log a fatal error and exit.
            logger.fatal({ err: migrationError }, "FATAL: Data migration failed during execution. Server shutting down.");
            process.exit(1); // Exit the process
        }
    } else {
        // Log if migration is skipped due to 'databaseVersion' key existing
        logger.info("Skipping data migration because the 'databaseVersion' key was found in the database.");
    }

    // --- Startup Email Sending Logic ---
    try {
        logger.info("Checking for startup email tasks...");
        // Define the highest mail version this server code supports. 
        // Increment this when you add new email content to EMAIL_VERSIONS_CONTENT in startupMailer.ts
        const LATEST_MAIL_VERSION_TARGET = "1"; 

        let currentMailVersionString: string | null = await db.get('versionLocks/mailVersion');
        
        let mailSentMap = await db.get('versionLocks/mailSentList');
        let mailSentList: string[] = [];
        if (mailSentMap) {
            const keys = Object.keys(mailSentMap);
            if (db instanceof FirebaseClient) {
                mailSentList = keys.map(key => db.unescapeFirebaseKeyPercentEncoding(key));
            } else {
                logger.warn("Database client is not an instance of FirebaseClient. Using raw keys for mailSentList which might be problematic if keys were escaped.");
                mailSentList = keys; // Fallback: use raw keys
            }
        }

        const allUsersData = await db.hGetAll('users');
        const allUserEmails: string[] = allUsersData ? Object.values(allUsersData).map((user: any) => user.email).filter(email => !!email) : [];

        if (!allUserEmails || allUserEmails.length === 0) {
            logger.info("No users found to send startup emails to. Skipping email process.");
        } else {
            let needsProcessing = false;
            let targetProcessingVersion = ""; // The "N" in "X->N" or "N" if fully migrated to N
            let currentTransitionState = currentMailVersionString; // The "X->N" string or final "N"

            if (currentMailVersionString === null) {
                logger.info(`No mailVersion found. Initializing for version ${LATEST_MAIL_VERSION_TARGET}.`);
                currentTransitionState = `0->${LATEST_MAIL_VERSION_TARGET}`;
                await db.set('versionLocks/mailVersion', currentTransitionState);
                await db.set('versionLocks/mailSentList', {}); // Initialize as empty object
                mailSentList = [];
                targetProcessingVersion = LATEST_MAIL_VERSION_TARGET;
                needsProcessing = true;
            } else if (currentMailVersionString.includes('->')) {
                const parts = currentMailVersionString.split('->');
                const dbTargetVersion = parts[1];
                logger.info(`Mail version is in transition: ${currentMailVersionString}. Target DB version: ${dbTargetVersion}`);
                if (parseInt(dbTargetVersion) <= parseInt(LATEST_MAIL_VERSION_TARGET)) {
                    targetProcessingVersion = dbTargetVersion;
                    needsProcessing = true;
                } else {
                    logger.warn(`Database mailVersion ${currentMailVersionString} aims for version ${dbTargetVersion}, but server code supports up to ${LATEST_MAIL_VERSION_TARGET}. Email processing for this version will be skipped.`);
                    needsProcessing = false;
                }
            } else { // Mail version is a number string, e.g., "1"
                if (parseInt(currentMailVersionString) < parseInt(LATEST_MAIL_VERSION_TARGET)) {
                    logger.info(`Current mailVersion ${currentMailVersionString} is less than server target ${LATEST_MAIL_VERSION_TARGET}. Starting new transition.`);
                    currentTransitionState = `${currentMailVersionString}->${LATEST_MAIL_VERSION_TARGET}`;
                    await db.set('versionLocks/mailVersion', currentTransitionState);
                    await db.set('versionLocks/mailSentList', {}); // Clear list for new transition
                    mailSentList = [];
                    targetProcessingVersion = LATEST_MAIL_VERSION_TARGET;
                    needsProcessing = true;
                } else {
                    logger.info(`Mail version ${currentMailVersionString} is up-to-date with or newer than server target ${LATEST_MAIL_VERSION_TARGET}. No startup emails needed.`);
                    needsProcessing = false;
                }
            }

            if (needsProcessing && EMAIL_VERSIONS_CONTENT[targetProcessingVersion]) {
                logger.info(`Processing startup emails for target version ${targetProcessingVersion} (current DB state: ${currentTransitionState}).`);
                
                // We need to compare apples to apples. Emails from allUserEmails are raw.
                // mailSentList now contains unescaped emails.
                const usersToEmail = allUserEmails.filter(email => !mailSentList.includes(email));

                if (usersToEmail.length > 0) {
                    logger.info(`Found ${usersToEmail.length} users to email for version ${targetProcessingVersion}.`);
                    const successfullySentTo = await sendStartupEmails(db, usersToEmail, targetProcessingVersion);
                    
                    // Update local mailSentList with newly sent emails (raw, unescaped form)
                    const newSentEmails = successfullySentTo.map(email => {
                        if (db instanceof FirebaseClient) {
                            // To get the raw email back for local list comparison after it was sanitized for DB storage as a key:
                            // 1. Sanitize it (as it would have been for the key in DB)
                            // 2. Unescape that sanitized key to get the original email back.
                            // This assumes sendStartupEmails correctly used sanitizedEmailKey for DB path, and successfullySentTo contains raw emails.
                            return db.unescapeFirebaseKeyPercentEncoding(db.sanitizeKey(email));
                        }
                        return email; // Fallback if not FirebaseClient
                    });
                    mailSentList = mailSentList.concat(newSentEmails);
                } else {
                    logger.info(`No new users to email for version ${targetProcessingVersion}. All users already in mailSentList or no users.`);
                }

                const allProcessed = allUserEmails.every(email => mailSentList.includes(email));

                if (allProcessed && allUserEmails.length > 0) { // Ensure allUserEmails is not empty before declaring all processed
                    logger.info(`All users processed for mail version ${targetProcessingVersion}. Finalizing version.`);
                    await db.set('versionLocks/mailVersion', targetProcessingVersion);
                    await db.del('versionLocks/mailSentList');
                    logger.info(`Mail version updated to ${targetProcessingVersion} and mailSentList cleared.`);
                } else if (allUserEmails.length > 0) { // Only log remaining if there were users to begin with
                     const remainingCount = allUserEmails.length - (mailSentList?.length || 0);
                     if (remainingCount > 0) {
                        logger.info(`Still ${remainingCount} users remaining for mail version ${targetProcessingVersion}. Will continue on next startup if needed.`);
                     } else if (!allProcessed) { // All emails are in mailSentList, but allProcessed is false (e.g. if allUserEmails was empty initially but now not)
                        logger.info(`All users appear in mailSentList for mail version ${targetProcessingVersion}, but allProcessed flag was false. Review logic if this state is unexpected.`);
                     } else { // All processed and allUserEmails not empty
                        logger.info(`All users processed for mail version ${targetProcessingVersion}. Waiting for finalization (this log should ideally not be hit if logic is correct and allProcessed was true).`);
                     }
                } else { // allUserEmails is empty
                    logger.info(`No users to process for mail version ${targetProcessingVersion}. Finalizing version.`);
                    await db.set('versionLocks/mailVersion', targetProcessingVersion);
                    await db.del('versionLocks/mailSentList');
                    logger.info(`Mail version updated to ${targetProcessingVersion} (no users to email) and mailSentList cleared.`);
                }
            } else if (needsProcessing && !EMAIL_VERSIONS_CONTENT[targetProcessingVersion]) {
                logger.error(`Cannot process startup emails: No email content defined for target mail version ${targetProcessingVersion}. DB state: ${currentTransitionState}`);
            }
        }
    } catch (emailError: any) {
        const baseMessage = "Error during startup email processing. This will not halt server startup.";
        if (emailError instanceof Error) {
            logger.error({ err: emailError, errorMessage: emailError.message }, baseMessage);
        } else {
            logger.error({ errContext: String(emailError) }, baseMessage);
        }
    }
    // --- End Startup Email Sending Logic ---

    // Only seed if import didn't run (assuming import replaces seed)
    if (process.env.NODE_ENV !== 'production') {
        logger.info('Development environment detected and import not enabled, seeding default stories...');
        // Cast db to the base interface for seeding
        // seedDevPosts(db);
    } else {
        logger.info('Production environment detected or import ran, skipping dev seed');
    }
    // --- End Import/Seed --- 

    // Inject DB instance into route modules
    setAuthDb(db);
    setFeedDb(db);
    setPostDb(db);
    setReplyDb(db);
    logger.info('Database instance injected into route modules.');
}).catch((err: Error) => {
    logger.error({ err }, 'Database connection failed');
    process.exit(1);
});

// --- Environment Variable Checks ---
const requiredEnvVars: string[] = [];
if (process.env.NODE_ENV === 'production') {
    requiredEnvVars.push(
        'MAGIC_LINK_SECRET', 
        'AUTH_TOKEN_SECRET',
        'EMAIL_HOST',
        'EMAIL_PORT',
        'EMAIL_USERNAME',
        'EMAIL_PASSWORD',
    );
}

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    logger.fatal(`FATAL ERROR: Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1); // Exit immediately
}
// --- End Environment Variable Checks ---


app.get('/health', (req: Request, res: Response): void => {
    res.status(200).json({ status: 'healthy' });
});

// --- Mount Routers ---
app.use('/api/auth', authRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/posts', postRoutes); 
app.use('/api/replies', replyRoutes);

// --- Start Server ---
app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
    logger.info(`Build hash: ${BUILD_HASH}`);
});
