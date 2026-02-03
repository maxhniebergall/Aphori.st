import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import logger from '../logger.js';

declare global {
  namespace Express {
    interface Response {
      locals: {
        requestId: string;
        startTime: number;
      };
    }
  }
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  const startTime = Date.now();

  res.locals.requestId = requestId;
  res.locals.startTime = startTime;

  // Log incoming request
  logger.debug('Incoming request', {
    requestId,
    method: req.method,
    path: req.path,
    query: req.query,
    userAgent: req.get('user-agent'),
  });

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 400 ? 'warn' : 'debug';

    logger[level]('Request completed', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
    });
  });

  next();
}
