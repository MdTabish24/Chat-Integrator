import { Request, Response, NextFunction } from 'express';
import { ErrorResponse } from '../types';

export class AppError extends Error {
  statusCode: number;
  code: string;
  retryable: boolean;
  details?: any;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    retryable: boolean = false,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    const errorResponse: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        retryable: err.retryable,
      },
    };

    return res.status(err.statusCode).json(errorResponse);
  }

  // Handle unexpected errors
  console.error('Unexpected error:', err);
  const errorResponse: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      retryable: false,
    },
  };

  return res.status(500).json(errorResponse);
};
