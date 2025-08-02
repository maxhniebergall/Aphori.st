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
import searchRoutes, { setDbAndVectorService as setSearchDbAndVectorService } from './routes/search.js';
import gamesRoutes from './routes/games/index.js';
import { initializeThemesServices, initializeThemesIndex } from './routes/games/themes/index.js';
import { checkAndRunMigrations, processStartupEmails } from './startUpChecks.js';
import { VectorService } from './services/vectorService.js'; // Import VectorService
import { LoggedDatabaseClient } from './db/LoggedDatabaseClient.js';
import { errorHandler } from './middleware/errorHandler.js';

// --- Embedding Provider Imports ---
import { EmbeddingProvider } from './services/embeddingProvider.js';
import { GCPEmbeddingProvider } from './services/gcpEmbeddingProvider.js';
import { MockEmbeddingProvider } from './services/mockEmbeddingProvider.js';
// --- End Embedding Provider Imports ---

dotenv.config();

const PORT = process.env.PORT || 5050;
export var SHUTDOWN_TIMEOUT = 60000; // 60 seconds

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

// --- Embedding Provider Setup ---
let embeddingProvider: EmbeddingProvider;

const NODE_ENV = process.env.NODE_ENV || 'development';
const EMBEDDING_MODEL_ID = 'gemini-embedding-exp-03-07'; 
const GEMINI_EMBEDDING_DIMENSION = 768; // Defaulting to 768, see for options: https://ai.google.dev/gemini-api/docs/models#gemini-embedding

if (NODE_ENV === 'production' || process.env.USE_VERTEX_AI_LOCALLY === 'true') {
  embeddingProvider = new GCPEmbeddingProvider(
    EMBEDDING_MODEL_ID,
    GEMINI_EMBEDDING_DIMENSION
  );
  logger.info("Using real VertexAIEmbeddingProvider.");
} else {
  embeddingProvider = new MockEmbeddingProvider();
  logger.info("Using MockEmbeddingProvider for local development.");
}
// --- End Embedding Provider Setup ---


let isDbReady = false;
let isVectorIndexReady = false; // Add flag for vector index
let vectorService: VectorService; // Global reference for health checks

// Database and Vector Index readiness check
app.use((req: Request, res: Response, next: NextFunction): void => {
    if (!isDbReady || !isVectorIndexReady) { // Check both flags
        logger.warn(`Service not ready (DB: ${isDbReady}, VectorIndex: ${isVectorIndexReady}), returning 503`);
        res.status(503).json({ 
            error: 'Service initializing, please try again in a moment'
        });
        return;
    }
    next();
});

// --- Graceful Shutdown --- 
const gracefulShutdown = async (signal: string, vectorService: VectorService) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    // Stop accepting new connections
    server.close(async (err) => {
        if (err) {
            logger.error({ err }, 'Error closing HTTP server');
            process.exit(1);
        }
        logger.info('HTTP server closed.');

        // Perform async cleanup
        try {
            logger.info('Shutting down Vector Service...');
            await vectorService.handleShutdown(); // Call vector service shutdown
            logger.info('Vector Service shut down complete.');

            logger.info('Graceful shutdown complete.');
            process.exit(0);
        } catch (shutdownErr) {
            logger.error({ err: shutdownErr }, 'Error during graceful shutdown cleanup');
            process.exit(1);
        }
    });

    // Force shutdown after timeout
    setTimeout(() => {
        logger.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT); // 30 second timeout
};
// --- End Graceful Shutdown ---

await db.connect().then(async () => { // Make the callback async
    logger.info('Database client connected');
    isDbReady = true;

    // --- Run Startup Checks --- 
    await checkAndRunMigrations(db); // Handles migration logic and potential exit
    await processStartupEmails(db); // Handles email logic
    // --- End Startup Checks ---    

    vectorService = new VectorService(db, embeddingProvider); // Pass the chosen provider

    // Register signal handlers for graceful shutdown - always set regardless of initialization success
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM', vectorService));
    process.on('SIGINT', () => gracefulShutdown('SIGINT', vectorService));

    // --- Initialize Vector Index ---
    try {
        await vectorService.initializeIndex();
        isVectorIndexReady = true;
        logger.info('Vector service index initialized successfully.');
    } catch (err) {
        logger.error({ err }, 'Failed to initialize vector service index. Service will start but search may be unavailable.');
        // Decide if this should be fatal. For now, let it continue but mark as not ready.
        isVectorIndexReady = false; 
        // Consider adding a health check status for vector index
    }
    // --- End Vector Index Initialization ---

    // --- Initialize Themes Game Services ---
    try {
        logger.info('Initializing themes game services...');
        initializeThemesServices(db);
        await initializeThemesIndex();
        logger.info('Simple themes game services initialized successfully.');
    } catch (err) {
        logger.error({ err }, 'Failed to initialize themes game services. Games may be unavailable.');
        // Non-fatal - main site can continue without games
    }
    // --- End Themes Services Initialization ---

    // Only seed if import didn't run (assuming import replaces seed)
    if (process.env.NODE_ENV !== 'production') {
        logger.info('Development environment detected and import not enabled, seeding default stories...');
        // Cast db to the base interface for seeding
        // seedDevPosts(db);
    } else {
        logger.info('Production environment detected or import ran, skipping dev seed');
    }
    // --- End Import/Seed --- 

    // Inject DB instance and VectorService into route modules
    setAuthDb(db);
    setFeedDb(db);
    setPostDb(db, vectorService); // Pass vectorService
    setReplyDb(db, vectorService); // Pass vectorService
    setSearchDbAndVectorService(db, vectorService); // Inject into search routes
    logger.info('Database and VectorService (with chosen EmbeddingProvider) instances injected into route modules.');
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
        'GEMINI_API_KEY'
    );
}

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    logger.fatal(`FATAL ERROR: Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1); // Exit immediately
}
// --- End Environment Variable Checks ---


app.get('/health', (_req: Request, res: Response): void => {
    res.status(200).json({ status: 'healthy' });
});

app.get('/health/vector-index', (_req: Request, res: Response): void => {
    try {
        if (!vectorService) {
            res.status(503).json({
                status: 'unavailable',
                error: 'Vector service not initialized',
                ready: false
            });
            return;
        }

        const indexStats = {
            ready: isVectorIndexReady,
            indexSize: vectorService['faissIndex'] ? vectorService['faissIndex'].ntotal() : 0,
            dimension: vectorService['embeddingDimension'],
            maxIndexSize: 10000, // MAX_FAISS_INDEX_SIZE constant
            pendingOperations: vectorService['pendingAddOperations'].size
        };

        const isHealthy = isVectorIndexReady && 
                         indexStats.indexSize >= 0 && 
                         indexStats.pendingOperations < 100; // Alert if too many pending

        res.status(isHealthy ? 200 : 503).json({
            status: isHealthy ? 'healthy' : 'degraded',
            ...indexStats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error({ err: error }, 'Error checking vector index health');
        res.status(500).json({
            status: 'error',
            error: 'Failed to check vector index health',
            ready: false
        });
    }
});

// --- Mount Routers ---
app.use('/api/auth', authRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/posts', postRoutes); 
app.use('/api/replies', replyRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/games', gamesRoutes);

// Add the error handling middleware as the last middleware
app.use(errorHandler);

// --- Start Server ---
const server = app.listen(PORT, () => { // Store server instance
    logger.info(`Server is running on port ${PORT}`);
});
