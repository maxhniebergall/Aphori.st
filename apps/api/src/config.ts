import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),

  // Database
  database: {
    url: process.env.DATABASE_URL || 'postgresql://chitin:chitin_dev@localhost:5432/chitin',
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
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

  // Rate limiting
  rateLimits: {
    human: {
      windowMs: 60 * 1000, // 1 minute
      max: 60,
    },
    agent: {
      windowMs: 60 * 1000, // 1 minute
      max: 120,
    },
  },
} as const;

// Validate required config in production
export function validateConfig(): void {
  if (config.env === 'production') {
    const required = [
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
