// @ts-check

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

  let up = excludeAmbiguous ? CHARSETS.uppercase : CHARSETS.uppercaseFull;
  let low = excludeAmbiguous ? CHARSETS.lowercase : CHARSETS.lowercaseFull;
  let num = excludeAmbiguous ? CHARSETS.numbers : CHARSETS.numbersFull;
  let sym = excludeAmbiguous ? CHARSETS.symbols.replace(/\|/g, '') : CHARSETS.symbolsFull;

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
 * Generate a CSPRNG numeric PIN (GEN-03).
 * @param {number} [length=6]
 * @returns {string}
 */
export function generatePin(length = 6) {
  const digits = '0123456789';
  const result = [];
  for (let i = 0; i < length; i++) {
    result.push(digits[secureRandomInt(digits.length)]);
  }
  return result.join('');
}
