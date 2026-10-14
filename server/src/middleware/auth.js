// @ts-check
import { verifyAccessToken } from '../../lib/tokens.js';

/**
 * Middleware: authenticates requests using JWT access token.
 * Sets req.user = { id, email, role }.
 * Never trusts client-supplied userId — always extracts from verified token (IDOR defense).
 * @type {import('express').RequestHandler}
 */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
  }

  const token = authHeader.slice(7).trim();
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch (err) {
    return res.status(401).json({
      error: { code: 'TOKEN_INVALID', message: 'Invalid or expired access token' },
    });
  }
}
