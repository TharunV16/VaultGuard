import { describe, it, expect } from 'vitest';
import {
  generatePassword,
  generatePassphrase,
  generatePin,
  secureRandomInt,
} from '../lib/generator.js';
import {
  calculateSecurityScore,
  normalizeSimilarBase,
  isPasswordOld,
} from '../lib/score.js';

// ── Generator tests ──────────────────────────────────────────────────────────

describe('generator: generatePassword', () => {
  it('returns correct length', () => {
    expect(generatePassword({ length: 24 })).toHaveLength(24);
    expect(generatePassword({ length: 8 })).toHaveLength(8);
  });

  it('only uppercase when flags set accordingly', () => {
    const pwd = generatePassword({ length: 40, uppercase: true, lowercase: false, numbers: false, symbols: false });
    expect(/^[A-Z]+$/.test(pwd)).toBe(true);
  });

  it('only lowercase when flags set accordingly', () => {
    const pwd = generatePassword({ length: 40, uppercase: false, lowercase: true, numbers: false, symbols: false });
    expect(/^[a-z]+$/.test(pwd)).toBe(true);
  });

  it('only digits when numbers only', () => {
    const pwd = generatePassword({ length: 20, uppercase: false, lowercase: false, numbers: true, symbols: false });
    expect(/^\d+$/.test(pwd)).toBe(true);
  });

  it('contains at least one character from each selected class (charset coverage)', () => {
    for (let i = 0; i < 5; i++) {
      const pwd = generatePassword({ length: 40, uppercase: true, lowercase: true, numbers: true, symbols: true });
      expect(/[A-Z]/.test(pwd)).toBe(true);
      expect(/[a-z]/.test(pwd)).toBe(true);
      expect(/\d/.test(pwd)).toBe(true);
      expect(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?~`]/.test(pwd)).toBe(true);
    }
  });

  it('excludes ambiguous chars when flag is set', () => {
    for (let i = 0; i < 10; i++) {
      const pwd = generatePassword({ length: 50, uppercase: true, lowercase: true, numbers: true, excludeAmbiguous: true });
      expect(/[O0Il1|]/.test(pwd)).toBe(false);
    }
  });

  it('distribution sanity: no single character dominates (bias check)', () => {
    const pwd = generatePassword({ length: 1000, uppercase: true, lowercase: true, numbers: true, symbols: false });
    const freq = {};
    for (const ch of pwd) freq[ch] = (freq[ch] || 0) + 1;
    const max = Math.max(...Object.values(freq));
    expect(max).toBeLessThan(100);
  });
});

describe('generator: generatePassphrase', () => {
  it('returns words joined by separator', () => {
    const pp = generatePassphrase({ words: 4, separator: '-', capitalize: false, includeNumber: false });
    expect(pp.split('-')).toHaveLength(4);
  });

  it('capitalizes words when requested', () => {
    const pp = generatePassphrase({ words: 4, separator: ' ', capitalize: true, includeNumber: false });
    const words = pp.split(' ');
    for (const w of words) {
      expect(w[0]).toBe(w[0].toUpperCase());
    }
  });

  it('appends a digit when includeNumber is true', () => {
    const pp = generatePassphrase({ words: 4, separator: '-', capitalize: false, includeNumber: true });
    expect(/\d/.test(pp)).toBe(true);
  });

  it('clamps words to 3..10', () => {
    const pp1 = generatePassphrase({ words: 1, separator: '-', capitalize: false, includeNumber: false });
    expect(pp1.split('-').length).toBeGreaterThanOrEqual(3);
    const pp2 = generatePassphrase({ words: 20, separator: '-', capitalize: false, includeNumber: false });
    expect(pp2.split('-').length).toBeLessThanOrEqual(10);
  });
});

describe('generator: generatePin', () => {
  it('returns only digits', () => {
    for (let i = 0; i < 10; i++) {
      const pin = generatePin(6);
      expect(/^\d+$/.test(pin)).toBe(true);
      expect(pin).toHaveLength(6);
    }
  });

  it('clamps length to 4..12', () => {
    expect(generatePin(2)).toHaveLength(4);
    expect(generatePin(20)).toHaveLength(12);
  });
});

describe('generator: secureRandomInt', () => {
  it('returns in [0, max)', () => {
    for (let i = 0; i < 100; i++) {
      const r = secureRandomInt(10);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(10);
    }
  });

  it('returns 0 for max <= 0', () => {
    expect(secureRandomInt(0)).toBe(0);
    expect(secureRandomInt(-5)).toBe(0);
  });
});

// ── Security score tests ─────────────────────────────────────────────────────

describe('score: normalizeSimilarBase', () => {
  it('lowercases and substitutes leet chars', () => {
    // @→a, $→s, 0→o: 'password', then !! → [1!|]→i so 'passwordii', strip \d\W_ trailing: 'ii' are letters, no strip
    const result = normalizeSimilarBase('P@$$w0rd!!');
    expect(result).toBeTruthy();
    expect(result.startsWith('password')).toBe(true);
  });

  it('groups similar leet variants to same normalized base', () => {
    // Two passwords with the same leet root normalize to the same string
    const base1 = normalizeSimilarBase('P@$$w0rd!!');
    const base2 = normalizeSimilarBase('password!!');
    expect(base1).toBe(base2);
  });

  it('strips trailing plain digits/punctuation that are not in leet map', () => {
    // Digits 9,8,6 etc are NOT in the leet map, \$ is but only as $→s
    // '99' stays as digits then get stripped by [\d\W_]+$
    const result = normalizeSimilarBase('superlongsecret99');
    expect(result).toBe('superlongsecret');
  });

  it('returns empty string when normalized result < 8 chars', () => {
    expect(normalizeSimilarBase('short')).toBe('');
    expect(normalizeSimilarBase('')).toBe('');
  });
});

describe('score: isPasswordOld', () => {
  it('returns true for dates > 180 days ago', () => {
    const old = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPasswordOld(old)).toBe(true);
  });

  it('returns false for dates < 180 days ago', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(isPasswordOld(recent)).toBe(false);
  });

  it('returns false for invalid or missing dates', () => {
    expect(isPasswordOld('')).toBe(false);
    expect(isPasswordOld('not-a-date')).toBe(false);
  });
});

describe('score: calculateSecurityScore formula', () => {
  const makeItem = (overrides) => ({
    _id: overrides._id || 'item1',
    type: 'login',
    password: 'testpassword',
    name: 'Test',
    deletedAt: null,
    passwordUpdatedAt: new Date().toISOString(),
    ...overrides,
  });

  it('returns 100 for empty vault', () => {
    const result = calculateSecurityScore({ items: [] });
    expect(result.score).toBe(100);
    expect(result.band).toBe('Excellent');
  });

  it('detects reused passwords', () => {
    const items = [
      makeItem({ _id: 'a', password: 'ReusedPass!!' }),
      makeItem({ _id: 'b', password: 'ReusedPass!!' }),
    ];
    const result = calculateSecurityScore({ items });
    expect(result.counts.reused).toBe(2);
    expect(result.score).toBeLessThan(100);
  });

  it('detects old passwords', () => {
    const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const items = [makeItem({ _id: 'a', password: 'MyStr0ngPassw0rd!!', passwordUpdatedAt: oldDate })];
    const result = calculateSecurityScore({ items });
    expect(result.counts.old).toBe(1);
  });

  it('applies MFA account penalty', () => {
    const result = calculateSecurityScore({
      items: [],
      accountStatus: { mfaEnabled: false, recoveryKeyConfirmed: true },
    });
    expect(result.score).toBe(90);
    expect(result.accountPenalty).toBe(10);
  });

  it('applies recovery key penalty', () => {
    const result = calculateSecurityScore({
      items: [],
      accountStatus: { mfaEnabled: true, recoveryKeyConfirmed: false },
    });
    expect(result.score).toBe(95);
    expect(result.accountPenalty).toBe(5);
  });

  it('detects master-equal password', () => {
    const items = [makeItem({ _id: 'a', password: 'MasterSecret99!!' })];
    const result = calculateSecurityScore({ items, masterPassword: 'MasterSecret99!!' });
    expect(result.counts.masterEqual).toBe(1);
  });

  it('detects breached items via breachMap', () => {
    const items = [makeItem({ _id: 'a', password: 'SomePass!!' })];
    const breachMap = new Map([['a', { breached: true, count: 1000 }]]);
    const result = calculateSecurityScore({ items, breachMap });
    expect(result.counts.breached).toBe(1);
    expect(result.score).toBe(0);
  });

  it('returns Excellent band for score 100', () => {
    expect(calculateSecurityScore({ items: [] }).band).toBe('Excellent');
  });

  it('ignores deleted items', () => {
    const items = [
      makeItem({ _id: 'a', password: 'weak', deletedAt: new Date().toISOString() }),
    ];
    const result = calculateSecurityScore({ items });
    expect(result.counts.totalLoginsWithPassword).toBe(0);
    expect(result.score).toBe(100);
  });

  it('ignores non-login item types', () => {
    const items = [{ _id: 'a', type: 'note', password: 'weak', deletedAt: null }];
    const result = calculateSecurityScore({ items });
    expect(result.counts.totalLoginsWithPassword).toBe(0);
  });
});
