/**
 * client/src/lib/crypto.js
 * Zero-knowledge client-side crypto using Web Crypto API only.
 *
 * Key hierarchy (per project.md §3.1):
 *   masterPassword + kdfSalt → PBKDF2-SHA256(600k) → masterKey
 *   masterKey → HKDF("vg-auth") → authKey  (sent to server; server hashes with scrypt)
 *   masterKey → HKDF("vg-enc")  → wrapKey  (wraps vaultKey with AES-GCM)
 *   vaultKey = random 256-bit (generated at registration, never leaves browser in plaintext)
 *   recoveryKey = random 160-bit (shown once; used to derive recoveryWrapKey)
 *
 * Item encryption:
 *   AES-256-GCM, 96-bit random IV per write, AAD = `${userId}:${itemId}`
 */

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'SHA-256';
const AES_KEY_LEN = 256;

// ── Encoding helpers ──────────────────────────────────────────────────────────

/** @param {Uint8Array} buf */
export function toHex(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {string} hex */
export function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** @param {Uint8Array} buf */
export function toBase64(buf) {
  return btoa(String.fromCharCode(...buf));
}

/** @param {string} b64 */
export function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ── KDF ───────────────────────────────────────────────────────────────────────

/**
 * Derive the masterKey from the master password using PBKDF2-SHA256 (600k iterations).
 * @param {string} password
 * @param {Uint8Array} salt - 16 bytes from kdfSalt
 * @returns {Promise<CryptoKey>} masterKey (non-extractable, for HKDF use only)
 */
export async function deriveMasterKey(password, salt) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const masterKeyBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    base,
    AES_KEY_LEN
  );
  return crypto.subtle.importKey(
    'raw',
    masterKeyBits,
    'HKDF',
    false,
    ['deriveKey']
  );
}

/**
 * Use HKDF to derive a sub-key from the masterKey.
 * @param {CryptoKey} masterKey
 * @param {string} info - purpose label e.g. "vg-auth" or "vg-enc"
 * @param {string[]} usages - KeyUsage array
 * @param {boolean} [extractable]
 * @returns {Promise<CryptoKey>}
 */
async function hkdfDerive(masterKey, info, usages, extractable = false) {
  const enc = new TextEncoder();
  // HKDF with zero-length salt (keying material is already strong from PBKDF2)
  const salt = new Uint8Array(32); // all zeros
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: PBKDF2_HASH, salt, info: enc.encode(info) },
    masterKey,
    { name: 'AES-GCM', length: AES_KEY_LEN },
    extractable,
    usages
  );
}

/**
 * Derive authKey from masterKey. Exported as raw hex to send to server.
 * @param {CryptoKey} masterKey
 * @returns {Promise<string>} 64-char hex
 */
export async function deriveAuthKey(masterKey) {
  const key = await hkdfDerive(masterKey, 'vg-auth', ['encrypt'], true);
  const raw = await crypto.subtle.exportKey('raw', key);
  return toHex(new Uint8Array(raw));
}

/**
 * Derive the wrapKey from masterKey. Used to wrap/unwrap the vaultKey.
 * @param {CryptoKey} masterKey
 * @returns {Promise<CryptoKey>} wrapKey (non-extractable, wrapKey/unwrapKey)
 */
export async function deriveWrapKey(masterKey) {
  return hkdfDerive(masterKey, 'vg-enc', ['wrapKey', 'unwrapKey'], false);
}

// ── VaultKey ──────────────────────────────────────────────────────────────────

/**
 * Generate a new random 256-bit vault key (non-extractable).
 * @returns {Promise<CryptoKey>}
 */
export async function generateVaultKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: AES_KEY_LEN }, true, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Wrap (encrypt) the vaultKey with the wrapKey using AES-GCM.
 * @param {CryptoKey} vaultKey
 * @param {CryptoKey} wrapKey
 * @returns {Promise<{ iv: string, ct: string }>} hex-encoded
 */
export async function wrapVaultKey(vaultKey, wrapKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, wrapKey, {
    name: 'AES-GCM',
    iv,
  });
  return { iv: toHex(iv), ct: toHex(new Uint8Array(wrapped)) };
}

/**
 * Unwrap the vaultKey using the wrapKey.
 * Returns a non-extractable AES-GCM key for encrypt/decrypt.
 * @param {{ iv: string, ct: string }} wrapped
 * @param {CryptoKey} wrapKey
 * @returns {Promise<CryptoKey>}
 */
export async function unwrapVaultKey(wrapped, wrapKey) {
  const iv = fromHex(wrapped.iv);
  const ct = fromHex(wrapped.ct);
  return crypto.subtle.unwrapKey(
    'raw',
    ct,
    wrapKey,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: AES_KEY_LEN },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Recovery key ──────────────────────────────────────────────────────────────

/**
 * Generate a 160-bit recovery key.
 * @returns {Uint8Array} 20 raw bytes
 */
export function generateRecoveryKeyBytes() {
  return crypto.getRandomValues(new Uint8Array(20));
}

/**
 * Encode recovery key as grouped Base32 (5 groups of 8 chars).
 * @param {Uint8Array} bytes
 * @returns {string} e.g. "ABCDEFGH IJKLMNOP QRSTUVWX YZ234567 ABCDEFGH"
 */
export function encodeRecoveryKey(bytes) {
  return bufferToBase32(bytes)
    .match(/.{1,8}/g)
    .join(' ');
}

/**
 * Decode a grouped Base32 recovery key to bytes.
 * @param {string} encoded
 * @returns {Uint8Array}
 */
export function decodeRecoveryKey(encoded) {
  return base32ToBuffer(encoded.replace(/\s/g, '').toUpperCase());
}

/**
 * Derive the recovery wrap key from recovery key bytes.
 * @param {Uint8Array} recoveryKeyBytes
 * @returns {Promise<CryptoKey>} AES-GCM wrapKey
 */
export async function deriveRecoveryWrapKey(recoveryKeyBytes) {
  const base = await crypto.subtle.importKey('raw', recoveryKeyBytes, 'HKDF', false, [
    'deriveKey',
  ]);
  const enc = new TextEncoder();
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: PBKDF2_HASH,
      salt: new Uint8Array(32),
      info: enc.encode('vg-recovery'),
    },
    base,
    { name: 'AES-GCM', length: AES_KEY_LEN },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Derive the recovery verifier from recovery key bytes. Sent to server as hex.
 * @param {Uint8Array} recoveryKeyBytes
 * @returns {Promise<string>} 64-char hex
 */
export async function deriveRecoveryVerifier(recoveryKeyBytes) {
  const base = await crypto.subtle.importKey('raw', recoveryKeyBytes, 'HKDF', false, [
    'deriveKey',
  ]);
  const enc = new TextEncoder();
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: PBKDF2_HASH,
      salt: new Uint8Array(32),
      info: enc.encode('vg-recovery-verify'),
    },
    base,
    { name: 'AES-GCM', length: AES_KEY_LEN },
    true,
    ['encrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  return toHex(new Uint8Array(raw));
}

// ── Item encryption ───────────────────────────────────────────────────────────

/**
 * Encrypt a vault item blob.
 * AAD = `${userId}:${itemId}` — binds ciphertext to its record.
 * @param {object} plainObj - decrypted item data
 * @param {CryptoKey} vaultKey
 * @param {string} userId
 * @param {string} itemId
 * @returns {Promise<{ iv: string, ct: string }>} hex-encoded
 */
export async function encryptItem(plainObj, vaultKey, userId, itemId) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = enc.encode(`${userId}:${itemId}`);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    vaultKey,
    enc.encode(JSON.stringify(plainObj))
  );
  return { iv: toHex(iv), ct: toHex(new Uint8Array(ct)) };
}

/**
 * Decrypt a vault item. Throws if AAD mismatches or ciphertext is tampered.
 * @param {{ iv: string, ct: string }} enc
 * @param {CryptoKey} vaultKey
 * @param {string} userId
 * @param {string} itemId
 * @returns {Promise<object>}
 */
export async function decryptItem(enc, vaultKey, userId, itemId) {
  const decoder = new TextDecoder();
  const textEnc = new TextEncoder();
  const iv = fromHex(enc.iv);
  const ct = fromHex(enc.ct);
  const aad = textEnc.encode(`${userId}:${itemId}`);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    vaultKey,
    ct
  );
  return JSON.parse(decoder.decode(plain));
}

// ── KDF params ────────────────────────────────────────────────────────────────

/**
 * Generate a new KDF salt (16 bytes).
 * @returns {string} hex string
 */
export function generateKdfSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/**
 * Return the KDF parameters object to send/store.
 * @param {string} saltHex
 * @returns {{ algo: string, iterations: number, salt: string }}
 */
export function kdfParams(saltHex) {
  return { algo: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: saltHex };
}

// ── Base32 helpers (shared with recovery key) ─────────────────────────────────
const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const B32_MAP = Object.fromEntries([...B32_CHARS].map((c, i) => [c, i]));

/** @param {Uint8Array} buf */
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
  return new Uint8Array(out);
}
