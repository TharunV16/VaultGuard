// @ts-check
import { EFF_SHORT_WORDLIST } from './wordlist.js';

const CHARSETS = {
  uppercase: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // Cleaned if ambiguous
  uppercaseFull: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijkmnopqrstuvwxyz',
  lowercaseFull: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '23456789',
  numbersFull: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?',
  symbolsFull: '!@#$%^&*()_+-=[]{}|;:,.<>?~`',
  ambiguous: 'O0Il1|',
};

/**
 * Return a CSPRNG random integer in range [0, max).
 * Uses rejection sampling to avoid modulo bias.
 * @param {number} max
 * @returns {number}
 */
export function secureRandomInt(max) {
  if (max <= 0) return 0;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  do {
    crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % max;
}

/**
 * Fisher-Yates in-place shuffle using CSPRNG.
 * @param {any[]} arr
 * @returns {any[]}
 */
export function secureShuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Generate a cryptographically secure random password (GEN-01).
 * @param {object} [options]
 * @param {number} [options.length=20]
 * @param {boolean} [options.uppercase=true]
 * @param {boolean} [options.lowercase=true]
 * @param {boolean} [options.numbers=true]
 * @param {boolean} [options.symbols=true]
 * @param {boolean} [options.excludeAmbiguous=false]
 * @returns {string}
 */
export function generatePassword({
  length = 20,
  uppercase = true,
  lowercase = true,
  numbers = true,
  symbols = true,
  excludeAmbiguous = false,
} = {}) {
  const chosenClasses = [];

  const up = excludeAmbiguous ? CHARSETS.uppercase : CHARSETS.uppercaseFull;
  const low = excludeAmbiguous ? CHARSETS.lowercase : CHARSETS.lowercaseFull;
  const num = excludeAmbiguous ? CHARSETS.numbers : CHARSETS.numbersFull;
  const sym = excludeAmbiguous ? CHARSETS.symbols.replace(/\|/g, '') : CHARSETS.symbolsFull;

  if (uppercase) chosenClasses.push(up);
  if (lowercase) chosenClasses.push(low);
  if (numbers) chosenClasses.push(num);
  if (symbols) chosenClasses.push(sym);

  if (chosenClasses.length === 0) {
    chosenClasses.push(low);
  }

  const result = [];

  // Guarantee at least one character from each selected class
  for (const charset of chosenClasses) {
    result.push(charset[secureRandomInt(charset.length)]);
  }

  // Combine full charset for remaining characters
  const pool = chosenClasses.join('');

  while (result.length < length) {
    result.push(pool[secureRandomInt(pool.length)]);
  }

  // Cryptographically shuffle to prevent class ordering leakage
  secureShuffle(result);

  return result.join('');
}

/**
 * Generate a memorable passphrase from the EFF short wordlist (GEN-02).
 * @param {object} [options]
 * @param {number} [options.words=6] - count of words (3..10)
 * @param {string} [options.separator='-']
 * @param {boolean} [options.capitalize=true]
 * @param {boolean} [options.includeNumber=true]
 * @returns {string}
 */
export function generatePassphrase({
  words = 6,
  separator = '-',
  capitalize = true,
  includeNumber = true,
} = {}) {
  const count = Math.max(3, Math.min(10, words));
  const list = EFF_SHORT_WORDLIST;
  const selectedWords = [];

  for (let i = 0; i < count; i++) {
    let word = list[secureRandomInt(list.length)];
    if (capitalize) {
      word = word.charAt(0).toUpperCase() + word.slice(1);
    }
    selectedWords.push(word);
  }

  if (includeNumber) {
    const digit = secureRandomInt(10);
    // Append number to random word or at the end
    const idx = secureRandomInt(selectedWords.length);
    selectedWords[idx] = `${selectedWords[idx]}${digit}`;
  }

  return selectedWords.join(separator);
}

/**
 * Generate a CSPRNG numeric PIN (GEN-03).
 * @param {number} [length=6] - length (4..12)
 * @returns {string}
 */
export function generatePin(length = 6) {
  const len = Math.max(4, Math.min(12, length));
  const digits = '0123456789';
  const result = [];
  for (let i = 0; i < len; i++) {
    result.push(digits[secureRandomInt(digits.length)]);
  }
  return result.join('');
}

/**
 * Calculate approximate entropy bits for generated secrets.
 * @param {'password'|'passphrase'|'pin'} type
 * @param {object} options
 * @returns {number}
 */
export function calculateEntropy(type, options = {}) {
  if (type === 'password') {
    const {
      length = 20,
      uppercase = true,
      lowercase = true,
      numbers = true,
      symbols = true,
      excludeAmbiguous = false,
    } = options;
    let poolSize = 0;
    if (uppercase) poolSize += excludeAmbiguous ? CHARSETS.uppercase.length : 26;
    if (lowercase) poolSize += excludeAmbiguous ? CHARSETS.lowercase.length : 26;
    if (numbers) poolSize += excludeAmbiguous ? CHARSETS.numbers.length : 10;
    if (symbols) poolSize += excludeAmbiguous ? CHARSETS.symbols.length : 32;
    if (poolSize === 0) poolSize = 26;
    return Math.round(length * Math.log2(poolSize));
  }

  if (type === 'passphrase') {
    const { words = 6, includeNumber = true } = options;
    let bits = words * Math.log2(EFF_SHORT_WORDLIST.length); // log2(1296) ≈ 10.34
    if (includeNumber) bits += Math.log2(10); // ≈ 3.32
    return Math.round(bits);
  }

  if (type === 'pin') {
    const { length = 6 } = options;
    return Math.round(length * Math.log2(10));
  }

  return 0;
}

// ── Generator Options Persistence (GEN-05: non-secret only in localStorage) ──
const STORAGE_KEY = 'vaultguard_gen_opts';

export function loadGeneratorOptions() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    return JSON.parse(saved);
  } catch {
    return null;
  }
}

export function saveGeneratorOptions(options) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Ignore localStorage write failures
  }
}
