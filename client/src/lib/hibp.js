// @ts-check
/**
 * client/src/lib/hibp.js
 * Have I Been Pwned Pwned Passwords range check using k-anonymity (BRE-01, BRE-02).
 * Never sends the full password or full hash. Only sends 5 hex characters.
 */

// Per-session in-memory cache of HIBP range responses (prefix -> Map<suffix, count>)
const prefixCache = new Map();

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
 * Fetch hash suffix map for a 5-char prefix from HIBP range API.
 * Uses per-session prefix cache.
 * @param {string} prefix 5-char uppercase hex
 * @returns {Promise<Map<string, number>>}
 */
async function fetchRange(prefix) {
  if (prefixCache.has(prefix)) {
    return prefixCache.get(prefix);
  }

  const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: {
      'Add-Padding': 'true', // Protects against response size side-channel
    },
  });

  if (!res.ok) {
    throw new Error(`HIBP API returned status ${res.status}`);
  }

  const text = await res.text();
  const map = new Map();
  const lines = text.split('\r\n');

  for (const line of lines) {
    const [hashSuffix, countStr] = line.split(':');
    if (hashSuffix && countStr) {
      map.set(hashSuffix.trim().toUpperCase(), parseInt(countStr.trim(), 10) || 0);
    }
  }

  prefixCache.set(prefix, map);
  return map;
}

/**
 * Check if a password appears in known breach datasets via HIBP range API (k-anonymity).
 * Returns { breached, count, error }. On network/API failure, error is true so callers
 * report "couldn't check" rather than falsely indicating "safe" (BRE-02).
 * @param {string} password
 * @returns {Promise<{ breached: boolean, count: number, error?: boolean }>}
 */
export async function checkBreach(password) {
  if (!password) return { breached: false, count: 0 };

  try {
    const hash = await sha1(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const suffixMap = await fetchRange(prefix);
    const count = suffixMap.get(suffix) || 0;

    return {
      breached: count > 0,
      count,
    };
  } catch (err) {
    // Network failure shows "couldn't check", never "safe" (BRE-02)
    return {
      breached: false,
      count: 0,
      error: true,
    };
  }
}

/**
 * Bulk breach check with bounded concurrency (concurrency 4 per BRE-02).
 * @param {Array<{ id: string, password: string }>} items
 * @param {number} [concurrency=4]
 * @param {(progress: { completed: number, total: number }) => void} [onProgress]
 * @returns {Promise<Map<string, { breached: boolean, count: number, error?: boolean }>>}
 */
export async function checkBreachBulk(items, concurrency = 4, onProgress) {
  const results = new Map();
  const queue = [...items];
  let completed = 0;

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      if (!item.password) {
        results.set(item.id, { breached: false, count: 0 });
      } else {
        const res = await checkBreach(item.password);
        results.set(item.id, res);
      }

      completed++;
      if (onProgress) {
        onProgress({ completed, total: items.length });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker());
  await Promise.all(workers);

  return results;
}
