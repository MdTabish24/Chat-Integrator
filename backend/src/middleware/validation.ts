import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

/**
 * Validation Middleware
 * 
 * Provides reusable validation schemas and middleware for request validation
 */

/**
 * Common validation schemas
 */
export const commonSchemas = {
  uuid: Joi.string().uuid(),
  email: Joi.string().email(),
  platform: Joi.string().valid(
    'telegram',
    'twitter',
    'linkedin',
    'instagram',
    'whatsapp',
    'facebook',
    'teams'
  ),
  pagination: Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).default(0),
  }),
  date: Joi.date().iso(),
};

/**
 * Message validation schemas
 */
export const messageSchemas = {
  sendMessage: Joi.object({
    content: Joi.string().min(1).max(10000).required(),
  }),
  getMessages: Joi.object({
    since: Joi.date().iso().optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    offset: Joi.number().integer().min(0).optional(),
  }),
  conversationId: Joi.object({
    conversationId: commonSchemas.uuid.required(),
  }),
  messageId: Joi.object({
    messageId: commonSchemas.uuid.required(),
  }),
};

/**
 * OAuth validation schemas
 */
export const oauthSchemas = {
  platform: Joi.object({
    platform: commonSchemas.platform.required(),
  }),
  accountId: Joi.object({
    accountId: commonSchemas.uuid.required(),
  }),
  callback: Joi.object({
    code: Joi.string().required(),
    state: Joi.string().required(),
    error: Joi.string().optional(),
    error_description: Joi.string().optional(),
  }),
};

/**
 * Conversation validation schemas
 */
export const conversationSchemas = {
  getConversations: Joi.object({
    limit: Joi.number().integer().min(1).max(100).optional(),
    offset: Joi.number().integer().min(0).optional(),
    platform: commonSchemas.platform.optional(),
  }),
};

/**
 * Webhook validation schemas
 */
export const webhookSchemas = {
  platform: Joi.object({
    platform: commonSchemas.platform.required(),
  }),
};

/**
 * Generic validation middleware factory
 */
export const validate = (schema: Joi.Schema, property: 'body' | 'query' | 'params' = 'body') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: errors,
          retryable: false,
        },
      });
      return;
    }

    // Replace request property with validated value
    req[property] = value;
    next();
  };
};
