// @ts-check
import { verifyStepUpToken } from '../../lib/tokens.js';

/**
  * Middleware: enforces step-up token verification for sensitive operations (AUTH-16).
  * Must run after requireAuth.
  * Checks header 'x-step-up-token' or request body 'stepUpToken'.
  * @type {import('express').RequestHandler}
  */
export function requireStepUp(req, res, next) {
  const token =
    req.headers['x-step-up-token']?.toString() ||
    req.body?.stepUpToken;

  if (!token) {
    return res.status(403).json({
      error: { code: 'STEP_UP_REQUIRED', message: 'Step-up authentication required for this action' },
    });
  }

  try {
    const payload = verifyStepUpToken(token);
    if (!req.user || payload.sub !== req.user.id) {
      return res.status(403).json({
        error: { code: 'STEP_UP_INVALID', message: 'Step-up token does not match active session' },
      });
    }
    req.stepUp = payload;
    next();
  } catch (err) {
    return res.status(403).json({
      error: { code: 'STEP_UP_INVALID', message: 'Invalid or expired step-up token' },
    });
  }
}
