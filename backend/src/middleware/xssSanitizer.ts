import { Request, Response, NextFunction } from 'express';
import DOMPurify from 'isomorphic-dompurify';

/**
 * XSS Sanitization Middleware
 * 
 * Sanitizes user input to prevent XSS attacks
 * Focuses on message content and other user-generated text
 */

/**
 * Sanitize a string value
 */
const sanitizeString = (value: string): string => {
  // Use DOMPurify to remove any HTML/script tags
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: [], // No HTML tags allowed
    ALLOWED_ATTR: [], // No attributes allowed
    KEEP_CONTENT: true, // Keep text content
  });
};

/**
 * Recursively sanitize an object
 */
const sanitizeObject = (obj: any): any => {
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (obj !== null && typeof obj === 'object') {
    const sanitized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * Middleware to sanitize request body
 * Applies to all routes that accept user input
 */
export const sanitizeInput = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  next();
};

/**
 * Sanitize message content specifically
 * More lenient than general sanitization - allows some formatting
 */
export const sanitizeMessageContent = (content: string): string => {
  // Allow basic text formatting but remove scripts and dangerous tags
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'br', 'p'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
  });
};

/**
 * Middleware specifically for message endpoints
 * Sanitizes message content while preserving basic formatting
 */
export const sanitizeMessageInput = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body && req.body.content && typeof req.body.content === 'string') {
    req.body.content = sanitizeMessageContent(req.body.content);
  }

  next();
};
