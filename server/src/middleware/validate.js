// @ts-check
import { ZodError } from 'zod';

/**
 * Validate request body against a Zod schema.
 * Strips unknown keys (strict mode is opted in per-schema).
 * @param {import('zod').ZodTypeAny} schema
 * @returns {import('express').RequestHandler}
 */
export function validate(schema) {
  return (req, _res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) next(err);
      else next(err);
    }
  };
}

/**
 * Validate req.query against a Zod schema.
 * @param {import('zod').ZodTypeAny} schema
 * @returns {import('express').RequestHandler}
 */
export function validateQuery(schema) {
  return (req, _res, next) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (err) {
      if (err instanceof ZodError) next(err);
      else next(err);
    }
  };
}
