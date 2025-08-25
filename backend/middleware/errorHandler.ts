import { Request, Response, NextFunction } from 'express';
import logger from '../logger.js';

export interface ApiError {
  error: string;
  message: string;
  code?: string;
  details?: unknown;
  timestamp?: string;
  requestId?: string;
}

export interface ValidationError extends Error {
  type: 'VALIDATION_ERROR';
  field?: string;
}

export const createStandardError = (error: string, message: string, code?: string, details?: unknown): ApiError => {
  return {
    error,
    message,
    code,
    details,
    timestamp: new Date().toISOString()
  };
};


export const createValidationError = (message: string, field?: string, requestId?: string): ApiError => {
  return {
    error: 'Validation Error',
    message,
    code: 'VALIDATION_ERROR',
    details: field ? { field } : undefined,
    requestId,
    timestamp: new Date().toISOString()
  };
};

const categorizeError = (err: Error): { status: number; category: string } => {
  const errorMessage = err.message.toLowerCase();
  
  // Vector-related errors
  if (errorMessage.includes('vector') || errorMessage.includes('embedding') || errorMessage.includes('faiss')) {
    return { status: 503, category: 'VECTOR_ERROR' };
  }
  
  // Database errors
  if (errorMessage.includes('database') || errorMessage.includes('firebase') || errorMessage.includes('rtdb')) {
    return { status: 503, category: 'DATABASE_ERROR' };
  }
  
  // Validation errors
  if (errorMessage.includes('validation') || errorMessage.includes('invalid') || errorMessage.includes('required')) {
    return { status: 400, category: 'VALIDATION_ERROR' };
  }
  
  // Authentication errors
  if (errorMessage.includes('auth') || errorMessage.includes('unauthorized') || errorMessage.includes('token')) {
    return { status: 401, category: 'AUTH_ERROR' };
  }
  
  // Rate limiting errors
  if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
    return { status: 429, category: 'RATE_LIMIT_ERROR' };
  }
  
  // Default to internal server error
  return { status: 500, category: 'INTERNAL_ERROR' };
};

export const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  const requestId = res.locals.requestId;
  const { status, category } = categorizeError(err);
  
  // Enhanced logging with categorization
  logger.error({ 
    err, 
    req: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body
    },
    requestId,
    errorCategory: category
  }, `${category}: ${err.message}`);

  // Create appropriate error response based on category
  let apiError: ApiError;
  
  switch (category) {
    case 'DATABASE_ERROR':
      apiError = createStandardError('Database Error', 'Database service is temporarily unavailable. Please try again later.', 'DATABASE_ERROR');
      break;
    case 'VALIDATION_ERROR':
      apiError = createValidationError(err.message, undefined, requestId);
      break;
    case 'AUTH_ERROR':
      apiError = createStandardError('Authentication Error', 'Authentication failed. Please check your credentials.', 'AUTH_ERROR');
      break;
    case 'RATE_LIMIT_ERROR':
      apiError = createStandardError('Rate Limit Exceeded', 'Too many requests. Please try again later.', 'RATE_LIMIT_ERROR');
      break;
    default:
      apiError = createStandardError('Internal Server Error', 'An unexpected error occurred. Please try again later.', 'INTERNAL_ERROR');
  }
  
  // Add requestId to response
  if (requestId) {
    apiError.requestId = requestId;
  }

  res.status(status).json(apiError);
};