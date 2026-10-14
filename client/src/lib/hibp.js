/**
 * client/src/lib/hibp.js
 * Have I Been Pwned Pwned Passwords range check using k-anonymity.
 * Never sends the full password or full hash. Only sends 5 hex characters.
 */

/**
 * Compute SHA-1 hex digest of a string using Web Crypto.
 * @param {string} text
 * @returns {Promise<string>} 40-char uppercase hex
 */
async function sha1(text) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-1', enc.encode(text));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * Check if a password appears in known breach datasets via HIBP range API.
 * @param {string} password
 * @returns {Promise<{ breached: boolean, count: number }>}
 */
export async function checkBreach(password) {
  if (!password) return { breached: false, count: 0 };

  const hash = await sha1(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: {
        'Add-Padding': 'true', // protects against response size side-channel
      },
    });

    if (!res.ok) {
      // If service is unreachable, fail open with warning rather than blocking user
      return { breached: false, count: 0 };
    }

    const text = await res.text();
    const lines = text.split('\r\n');

    for (const line of lines) {
      const [hashSuffix, countStr] = line.split(':');
      if (hashSuffix && hashSuffix.trim() === suffix) {
        return { breached: true, count: parseInt(countStr || '0', 10) };
      }
    }

    return { breached: false, count: 0 };
  } catch (err) {
    return { breached: false, count: 0 };
  }
}
