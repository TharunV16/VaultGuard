// @ts-check
import { logger } from '../logger.js';

/**
 * Central error handler (Express 5 catches async rejections automatically).
 * @type {import('express').ErrorRequestHandler}
 */
export function errorHandler(err, _req, res, _next) {
  // Validation errors from zod (thrown by validate middleware)
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: { code: 'VALIDATION', message: 'Validation failed', details: err.flatten() },
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: { code: 'TOKEN_EXPIRED', message: 'Token invalid or expired' },
    });
  }

  // Known app errors (thrown with .statusCode and .code set)
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: { code: err.code ?? 'ERROR', message: err.message },
    });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    return res.status(409).json({
      error: { code: 'CONFLICT', message: 'Duplicate key' },
    });
  }

  // Payload too large (from express body parser)
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
    });
  }

  // Default 500 — never leak internals
  logger.error({ err }, 'Unhandled server error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}

/**
 * Create an application error with status code and code string.
 * @param {number} statusCode
 * @param {string} code
 * @param {string} message
 */
export function appError(statusCode, code, message) {
  const err = new Error(message);
  // @ts-ignore
  err.statusCode = statusCode;
  // @ts-ignore
  err.code = code;
  return err;
}
