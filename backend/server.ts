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
- Returns compressed reply data from Redis
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
import { seedDevPosts } from './seed.js';
import * as fsSync from 'fs'; // Keep sync fs for existsSync
import { fileURLToPath } from 'url';
import path from 'path';
import { dirname } from 'path';
import { 
    DatabaseClient as DatabaseClientType,
} from './types/index.js';
import requestLogger from './middleware/requestLogger.js';
import authRoutes, { setDb as setAuthDb } from './routes/auth.js';
import feedRoutes, { setDb as setFeedDb } from './routes/feed.js';
import postRoutes, { setDb as setPostDb } from './routes/posts.js';
import replyRoutes, { setDb as setReplyDb } from './routes/replies.js';
import { migrate } from './migrate.js';
import { importRtdbData } from './import_rtdb.js'; 

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Frontend-Hash'],
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

// Use the imported type for the db instance
const db: DatabaseClientType = createDatabaseClient() as DatabaseClientType;

let isDbReady = false;

/**
 * Imports data from a Firebase Realtime Database export JSON file into the DB.
 * Triggered by IMPORT_RTDB=true environment variable.
 * @param dbClient The connected database client instance.
 * @throws {Error} If file reading, JSON parsing, or database operations fail.
 */
async function runRtdbImportIfEnabled(dbClient: DatabaseClientType): Promise<void> {
    if (process.env.IMPORT_RTDB !== 'true') {
        logger.info("Skipping RTDB data import (IMPORT_RTDB is not 'true').");
        return;
    }

    const jsonFilePath = process.env.RTDB_EXPORT_PATH;
    if (!jsonFilePath) {
        throw new Error("RTDB_EXPORT_PATH environment variable is not set, but IMPORT_RTDB is true.");
    }

    // Call the import function from import_rtdb.ts
    await importRtdbData(jsonFilePath, dbClient); // Pass the file path and db client
}

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

    // --- Run Import or Seed --- 
    try {
        await runRtdbImportIfEnabled(db); // Attempt import first

        // --- Run Migration --- (Only if import was run or if specifically enabled)
        if (process.env.RUN_MIGRATION === 'true') {
             if (process.env.IMPORT_RTDB === 'true') {
                 logger.info('IMPORT_RTDB was true, proceeding with migration...');
             } else {
                 logger.info('RUN_MIGRATION was true (even without import), proceeding with migration...');
             }
             try {
                 await migrate(db); // Run the migration logic
                 logger.info('Data migration completed successfully.');
             } catch (migrationError) {
                 logger.fatal({ err: migrationError }, "FATAL: Data migration failed. Server shutting down.");
                 process.exit(1); // Stop server if migration fails
             }
         } else {
             logger.info("Skipping data migration (RUN_MIGRATION is not 'true').");
         }
        // --- End Migration ---

    } catch (importError) {
        logger.fatal({ err: importError }, "FATAL: RTDB data import failed. Server shutting down.");
        process.exit(1); // Stop server if import fails
    }

    // Only seed if import didn't run (assuming import replaces seed)
    if (process.env.IMPORT_RTDB !== 'true' && process.env.NODE_ENV !== 'production') {
        logger.info('Development environment detected and import not enabled, seeding default stories...');
        // Cast db to the base interface for seeding
        seedDevPosts(db);
    } else if (process.env.IMPORT_RTDB === 'true') {
        logger.info('RTDB import was enabled, skipping development seed.');
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

// Constants for user-related keys
const USER_PREFIX = 'user';
const USER_IDS_SET = 'user_ids';
const EMAIL_TO_ID_PREFIX = 'email_to_id';

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
        'REDIS_URL' // Add REDIS_URL if applicable
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
