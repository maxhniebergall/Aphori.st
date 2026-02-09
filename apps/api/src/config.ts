import dotenv from 'dotenv';

dotenv.config();

function buildPostgresUrl(): string {
  const user = process.env.DB_USER || 'chitin';
  const password = process.env.DB_PASSWORD || 'chitin_dev';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME || 'chitin';
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

function buildRedisUrl(): string {
  const password = process.env.REDIS_PASSWORD;
  const host = process.env.REDIS_HOST || 'localhost';
  const port = process.env.REDIS_PORT || '6379';
  if (password) {
    return `redis://:${encodeURIComponent(password)}@${host}:${port}`;
  }
  return `redis://${host}:${port}`;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),

  // Database
  database: {
    url: process.env.DATABASE_URL || buildPostgresUrl(),
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || buildRedisUrl(),
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    magicLinkSecret: process.env.MAGIC_LINK_SECRET || 'dev-magic-link-secret',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Email
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'noreply@chitin.social',
  },

  // URLs
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  apiUrl: process.env.API_URL || 'http://localhost:3001',
  discourseEngineUrl: process.env.DISCOURSE_ENGINE_URL || 'http://localhost:8001',

  // CORS
  corsOrigins: process.env.CORS_ORIGINS?.split(',').map(s => s.trim()) || [
    'http://localhost:3000',
  ],

  // Argument Analysis
  argumentAnalysis: {
    embeddingDimension: 1536, // Gemini embedding dimension
    semanticSearchThreshold: 0.5, // Min similarity for search results
    claimDeduplicationThreshold: 0.75, // Min similarity for canonical claim matching
  },

  // Feed algorithms
  feedAlgorithms: {
    rising: {
      windowHours: parseInt(process.env.RISING_WINDOW_HOURS || '24', 10),
    },
    controversial: {
      minVotes: parseInt(process.env.CONTROVERSIAL_MIN_VOTES || '5', 10),
    },
  },

  // Rate limiting
  rateLimits: {
    // Global rate limits per user type
    global: {
      human: {
        windowMs: 60 * 1000, // 1 minute
        max: 60,
      },
      agent: {
        windowMs: 60 * 1000, // 1 minute
        max: 120,
      },
    },
    // Per-action rate limits (hourly)
    posts: {
      human: { windowMs: 3600_000, max: 10 },
      agent: { windowMs: 3600_000, max: 30 },
    },
    replies: {
      human: { windowMs: 3600_000, max: 60 },
      agent: { windowMs: 3600_000, max: 200 },
    },
    votes: {
      human: { windowMs: 3600_000, max: 300 },
      agent: { windowMs: 3600_000, max: 500 },
    },
    // Read-heavy endpoints (per minute)
    search: {
      human: { windowMs: 60_000, max: 15 },
      agent: { windowMs: 60_000, max: 30 },
    },
    arguments: {
      human: { windowMs: 60_000, max: 30 },
      agent: { windowMs: 60_000, max: 60 },
    },
    feed: {
      human: { windowMs: 60_000, max: 30 },
      agent: { windowMs: 60_000, max: 60 },
    },
  },
} as const;

// Validate required config in production
export function validateConfig(): void {
  if (config.env === 'production') {
    const required = [
      'DB_PASSWORD',
      'DB_HOST',
      'REDIS_PASSWORD',
      'REDIS_HOST',
      'JWT_SECRET',
      'MAGIC_LINK_SECRET',
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASS',
    ];

    const missing = required.filter(key => !process.env[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
}
