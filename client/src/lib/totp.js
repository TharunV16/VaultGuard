/**
 * client/src/lib/totp.js
 * Client-side TOTP calculation (RFC 6238 / RFC 4226) via Web Crypto.
 */

/**
 * Base32 character set (RFC 4648)
 */
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode Base32 string to Uint8Array.
 * @param {string} b32
 * @returns {Uint8Array}
 */
export function base32ToBytes(b32) {
  const clean = b32.toUpperCase().replace(/[\s-=]/g, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = B32_ALPHABET.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

/**
 * Parse an otpauth:// URI or raw Base32 secret.
 * @param {string} seedOrUri
 * @returns {string} clean Base32 secret
 */
export function parseTotpSecret(seedOrUri) {
  if (!seedOrUri) return '';
  const trimmed = seedOrUri.trim();
  if (trimmed.startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed);
      return url.searchParams.get('secret') || '';
    } catch {
      return '';
    }
  }
  return trimmed;
}

/**
 * Generate current 6-digit TOTP code and countdown using Web Crypto.
 * @param {string} seedOrUri
 * @param {number} [timeMs]
 * @returns {Promise<{ code: string, remainingSeconds: number }>}
 */
export async function generateTotp(seedOrUri, timeMs = Date.now()) {
  const rawSecret = parseTotpSecret(seedOrUri);
  if (!rawSecret) {
    return { code: '', remainingSeconds: 0 };
  }

  const keyBytes = base32ToBytes(rawSecret);
  if (keyBytes.length === 0) {
    return { code: '', remainingSeconds: 0 };
  }

  const epochSeconds = Math.floor(timeMs / 1000);
  const step = 30;
  const counter = Math.floor(epochSeconds / step);
  const remainingSeconds = step - (epochSeconds % step);

  // Counter as 8-byte big-endian
  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  // Upper 4 bytes: 0, Lower 4 bytes: counter
  counterView.setUint32(0, Math.floor(counter / 0x100000000), false);
  counterView.setUint32(4, counter >>> 0, false);

  // Import key for HMAC-SHA1
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: { name: 'SHA-1' } },
    false,
    ['sign']
  );

  const hmacSig = await crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
  const hmacBytes = new Uint8Array(hmacSig);

  // Dynamic truncation (RFC 4226 §5.4)
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const binary =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  const otp = (binary % 1000000).toString().padStart(6, '0');
  return { code: otp, remainingSeconds };
}
