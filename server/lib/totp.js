// @ts-check
/**
 * server/lib/totp.js
 * RFC 6238 TOTP using node:crypto only (~25 lines of logic).
 * Tested against RFC 6238 test vectors.
 */
import { createHmac, randomBytes } from 'node:crypto';

const STEP = 30; // seconds
const DIGITS = 6;

/**
 * Compute a single TOTP code.
 * @param {Buffer} secret - raw TOTP secret bytes
 * @param {number} counter - TOTP counter value (Math.floor(unixTs / STEP))
 * @returns {string} zero-padded 6-digit code
 */
function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  // write 64-bit big-endian counter
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    Math.pow(10, DIGITS);
  return String(code).padStart(DIGITS, '0');
}

/**
 * Verify a TOTP code. Accepts ±1 step for clock skew.
 * Caller must enforce last-used-step to prevent replay.
 * @param {string} secretBase32 - Base32-encoded TOTP secret
 * @param {string} code - 6-digit string from the user
 * @param {number} [nowSec] - Unix time in seconds (override for testing)
 * @returns {{ valid: boolean, step: number }}
 */
export function verifyTotp(secretBase32, code, nowSec = Math.floor(Date.now() / 1000)) {
  const secret = base32ToBuffer(secretBase32);
  const step = Math.floor(nowSec / STEP);
  for (const offset of [-1, 0, 1]) {
    if (hotp(secret, step + offset) === code) {
      return { valid: true, step: step + offset };
    }
  }
  return { valid: false, step };
}

/**
 * Generate a new random TOTP secret (20 bytes, Base32-encoded).
 * @returns {string} Base32 secret
 */
export function generateTotpSecret() {
  return bufferToBase32(randomBytes(20));
}

/**
 * Build a otpauth:// URI for QR code generation.
 * @param {string} email
 * @param {string} secretBase32
 * @param {string} [issuer]
 * @returns {string}
 */
export function totpUri(email, secretBase32, issuer = 'VaultGuard') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ── Base32 (RFC 4648, uppercase, no padding) ─────────────────────────────────
const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const B32_MAP = Object.fromEntries([...B32_CHARS].map((c, i) => [c, i]));

/** @param {Buffer} buf */
function bufferToBase32(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_CHARS[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_CHARS[(value << (5 - bits)) & 0x1f];
  return out;
}

/** @param {string} s */
function base32ToBuffer(s) {
  s = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of s) {
    const v = B32_MAP[c];
    if (v === undefined) throw new Error(`Invalid base32 char: ${c}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
