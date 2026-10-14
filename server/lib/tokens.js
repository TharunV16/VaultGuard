// @ts-check
/**
 * server/lib/tokens.js
 * JWT access tokens and opaque rotating refresh tokens.
 */
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { config } from '../src/config.js';
import { hashToken } from './crypto.js';

const { sign, verify } = jwt;

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

/**
 * Issue a short-lived MFA pending token (5 min).
 * @param {{ id: string, email: string }} user
 * @returns {string} signed JWT with scope 'mfa'
 */
export function issueMfaToken(user) {
  return sign(
    { sub: user.id, email: user.email, scope: 'mfa' },
    config.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '5m',
      issuer: 'vaultguard',
      audience: 'vaultguard-client',
    }
  );
}

/**
 * Verify an MFA token. Throws if invalid or expired.
 * @param {string} token
 * @returns {import('jsonwebtoken').JwtPayload}
 */
export function verifyMfaToken(token) {
  const payload = verify(token, config.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: 'vaultguard',
    audience: 'vaultguard-client',
  });
  if (typeof payload === 'string' || payload.scope !== 'mfa') {
    throw new Error('Invalid token scope');
  }
  return payload;
}

/**
 * Issue a single-purpose step-up token (5 min per AUTH-16).
 * @param {{ id: string, email: string }} user
 * @returns {string} signed JWT with scope 'step_up'
 */
export function issueStepUpToken(user) {
  return sign(
    { sub: user.id, email: user.email, scope: 'step_up' },
    config.JWT_ACCESS_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '5m',
      issuer: 'vaultguard',
      audience: 'vaultguard-client',
    }
  );
}

/**
 * Verify a step-up token. Throws if invalid or expired.
 * @param {string} token
 * @returns {import('jsonwebtoken').JwtPayload}
 */
export function verifyStepUpToken(token) {
  const payload = verify(token, config.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: 'vaultguard',
    audience: 'vaultguard-client',
  });
  if (typeof payload === 'string' || payload.scope !== 'step_up') {
    throw new Error('Invalid token scope');
  }
  return payload;
}

