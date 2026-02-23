import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config.js';
import logger from './logger.js';
import { getPool, closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { initArgumentService } from './services/argumentService.js';
import { closeV3Queue } from './jobs/v3Queue.js';
import { syncSystemAccountsFromSecret } from './services/systemAccountSync.js';
import { syncServiceAccountAllowlist } from './cache/serviceAccountAllowlist.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { optionalAuth } from './middleware/auth.js';
import { combinedRateLimiter } from './middleware/rateLimit.js';
import { ipBlocklistMiddleware } from './middleware/ipBlocklist.js';
import authRoutes from './routes/auth.js';
import postsRoutes from './routes/posts.js';
import repliesRoutes from './routes/replies.js';
import votesRoutes from './routes/votes.js';
import feedRoutes from './routes/feed.js';
import argumentRoutes from './routes/arguments.js';
import searchRoutes from './routes/search.js';
import agentRoutes from './routes/agents.js';
import userRoutes from './routes/users.js';
import notificationRoutes from './routes/notifications.js';
import statsRoutes from './routes/stats.js';
import v3Routes from './routes/v3.js';
import internalRoutes from './routes/internal.js';

// Validate config on startup
validateConfig();

const app: ReturnType<typeof express> = express();

// Trust proxy for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Security headers
app.use(helmet());

// IP blocklist — checked before auth, rate limiting, and route handlers
app.use(ipBlocklistMiddleware);

// CORS
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '50kb' }));

// Optional auth for rate limiting (identifies user if token present)
app.use(optionalAuth);

// Request logging (after auth so logs include user context)
app.use(requestLogger);

// Rate limiting (per-user-type limits, requires auth to classify user)
app.use(combinedRateLimiter);

// Database readiness flag
let isDbReady = false;

// Database readiness check middleware
app.use((req: Request, res: Response, next: NextFunction): void => {
  if (!isDbReady && req.path !== '/health') {
    res.status(503).json({
      error: 'Service Unavailable',
      message: 'Service is initializing, please try again shortly',
    });
    return;
  }
  next();
});

// Health check
app.get('/health', (_req: Request, res: Response): void => {
  res.json({
    status: isDbReady ? 'healthy' : 'initializing',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/posts', postsRoutes);
app.use('/api/v1/replies', repliesRoutes);
app.use('/api/v1/votes', votesRoutes);
app.use('/api/v1/feed', feedRoutes);
app.use('/api/v1/arguments', argumentRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v3', v3Routes);

// Internal service-to-service routes (protected by shared secret, not public auth)
app.use('/internal', internalRoutes);

// 404 handler
app.use((_req: Request, res: Response): void => {
  res.status(404).json({
    error: 'Not Found',
    message: 'The requested resource was not found',
  });
});

// Error handler
app.use(errorHandler);

// Graceful shutdown
const SHUTDOWN_TIMEOUT = 30000;

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  server.close(async (err) => {
    if (err) {
      logger.error('Error closing HTTP server', { error: err.message });
      process.exit(1);
    }

    logger.info('HTTP server closed');

    try {
      await closeV3Queue();
      logger.info('Queue and worker closed');
      await closePool();
      logger.info('Database connections closed');
      process.exit(0);
    } catch (error) {
      logger.error('Error closing resources', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  });

  // Force shutdown after timeout
  setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
}

// Initialize database connection
async function init(): Promise<void> {
  try {
    // Test database connection
    const pool = getPool();
    await pool.query('SELECT 1');
    logger.info('Database connection established');

    // Run migrations before accepting traffic
    await migrate();

    // Sync system accounts from Secret Manager (non-fatal)
    try {
      await syncSystemAccountsFromSecret();
    } catch (error) {
      logger.warn('Failed to sync system accounts (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Warm service account allowlist cache (non-fatal)
    try {
      await syncServiceAccountAllowlist();
    } catch (error) {
      logger.warn('Failed to sync service account allowlist (non-fatal)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    isDbReady = true;

    // Initialize discourse-engine connection
    try {
      await initArgumentService();
      logger.info('discourse-engine connected and ready');
    } catch (error) {
      logger.error('discourse-engine unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue startup - background jobs will retry
    }

  } catch (error) {
    logger.error('Failed to connect to database', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Start server
const server = app.listen(config.port, async () => {
  await init();
  logger.info(`Server running on port ${config.port}`);
});

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
