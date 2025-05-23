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
import { checkAndRunMigrations, processStartupEmails } from './startUpChecks.js';

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

    // --- Run Startup Checks --- 
    await checkAndRunMigrations(db); // Handles migration logic and potential exit
    await processStartupEmails(db); // Handles email logic
    // --- End Startup Checks ---    

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
