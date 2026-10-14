// @ts-check
/**
 * server/lib/crypto.js
 * Server-side crypto helpers using node:crypto only.
 * Never receives or stores plaintext vault keys or master passwords.
 */
import { createHmac, randomBytes, scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../src/config.js';

const scryptAsync = promisify(scrypt);

// ── Server encryption key (AES-256-GCM for TOTP secrets at rest) ────────────
const SERVER_KEY = Buffer.from(config.SERVER_ENCRYPTION_KEY, 'base64'); // 32 bytes

// ── scrypt params per SRS Appendix A ────────────────────────────────────────
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

/**
 * Hash the client-supplied authKey with scrypt.
 * @param {string} authKeyHex - Hex-encoded 256-bit authKey from the client.
 * @returns {Promise<{salt: string, hash: string}>} salt and hash as hex strings.
 */
export async function hashAuthKey(authKeyHex) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(
    Buffer.from(authKeyHex, 'hex'),
    Buffer.from(salt, 'hex'),
    SCRYPT_KEYLEN,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }
  );
  return { salt, hash: key.toString('hex') };
}

/**
 * Verify a client authKey against a stored scrypt hash.
 * Constant-time to prevent timing attacks.
 * @param {string} authKeyHex
 * @param {string} storedSalt - hex
 * @param {string} storedHash - hex
 * @returns {Promise<boolean>}
 */
export async function verifyAuthKey(authKeyHex, storedSalt, storedHash) {
  const key = await scryptAsync(
    Buffer.from(authKeyHex, 'hex'),
    Buffer.from(storedSalt, 'hex'),
    SCRYPT_KEYLEN,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }
  );
  const a = key;
  const b = Buffer.from(storedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Hash a high-entropy token (refresh token, recovery token, backup code) with SHA-256.
 * @param {string} tokenHex
 * @returns {string} hex digest
 */
export function hashToken(tokenHex) {
  return createHmac('sha256', SERVER_KEY)
    .update(Buffer.from(tokenHex, 'hex'))
    .digest('hex');
}

/**
 * Hash a recovery verifier (derived by the client) with SHA-256 via HMAC-SERVER_KEY.
 * @param {string} verifierHex
 * @returns {string} hex digest
 */
export function hashRecoveryVerifier(verifierHex) {
  return createHmac('sha256', SERVER_KEY)
    .update(Buffer.from(verifierHex, 'hex'))
    .digest('hex');
}

/**
 * Encrypt a small payload (e.g., TOTP secret) with AES-256-GCM using the server key.
 * @param {string} plaintext - UTF-8 string
 * @returns {{ iv: string, ct: string, tag: string }} hex-encoded fields
 */
export function encryptServerData(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SERVER_KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    ct: ct.toString('hex'),
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt a payload encrypted with encryptServerData.
 * @param {{ iv: string, ct: string, tag: string }} enc
 * @returns {string} plaintext UTF-8 string
 */
export function decryptServerData({ iv, ct, tag }) {
  const decipher = createDecipheriv('aes-256-gcm', SERVER_KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return (
    decipher.update(Buffer.from(ct, 'hex')).toString('utf8') +
    decipher.final('utf8')
  );
}

/**
 * Constant-time comparison of two hex strings.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Generate cryptographically secure random bytes.
 * @param {number} bytes
 * @returns {string} hex string
 */
export function randomHex(bytes) {
  return randomBytes(bytes).toString('hex');
}
