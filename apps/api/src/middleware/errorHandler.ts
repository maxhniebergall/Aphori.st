import { Request, Response, NextFunction } from 'express';
import logger from '../logger.js';
import type { ApiError } from '@chitin/shared';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error
  logger.error('Request error', {
    path: req.path,
    method: req.method,
    error: err.message,
    stack: err.stack,
  });

  // Handle known errors
  if (err instanceof AppError) {
    const response: ApiError = {
      error: err.code,
      message: err.message,
      details: err.details,
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Handle validation errors from express-validator or zod
  if (err.name === 'ValidationError' || err.name === 'ZodError') {
    const response: ApiError = {
      error: 'Validation Error',
      message: err.message,
    };
    res.status(400).json(response);
    return;
  }

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    const response: ApiError = {
      error: 'Bad Request',
      message: 'Invalid JSON in request body',
    };
    res.status(400).json(response);
    return;
  }

  // Default to 500 Internal Server Error
  const response: ApiError = {
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
  };
  res.status(500).json(response);
}
