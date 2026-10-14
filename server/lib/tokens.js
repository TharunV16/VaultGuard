// @ts-check
/**
 * server/lib/tokens.js
 * JWT access tokens and opaque rotating refresh tokens.
 */
import { sign, verify } from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { hashToken } from './crypto.js';

const ACCESS_TTL = '10m';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Issue a signed access token.
 * @param {{ id: string, email: string, role: string }} user
 * @returns {string} signed JWT
 */
export function issueAccessToken(user) {
  return sign(
    { sub: user.id, email: user.email, role: user.role },
    config.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: ACCESS_TTL,
      issuer: 'vaultguard',
      audience: 'vaultguard-client',
    }
  );
}

/**
 * Verify an access token. Throws if invalid/expired.
 * @param {string} token
 * @returns {import('jsonwebtoken').JwtPayload}
 */
export function verifyAccessToken(token) {
  return /** @type {import('jsonwebtoken').JwtPayload} */ (
    verify(token, config.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'vaultguard',
      audience: 'vaultguard-client',
    })
  );
}

/**
 * Generate an opaque refresh token.
 * @returns {{ raw: string, hash: string, expiresAt: Date }}
 */
export function generateRefreshToken() {
  const raw = randomBytes(32).toString('hex');
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  return { raw, hash, expiresAt };
}

/**
 * Hash an incoming raw refresh token for lookup.
 * @param {string} raw
 * @returns {string}
 */
export function hashRefreshToken(raw) {
  return hashToken(raw);
}
