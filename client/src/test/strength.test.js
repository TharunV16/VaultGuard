import { describe, it, expect, vi } from 'vitest';
import { evaluatePassword } from '../lib/strength.js';
import { checkBreach } from '../lib/hibp.js';

describe('client strength evaluator (zxcvbn)', () => {
  it('penalizes very short or common passwords', () => {
    const res1 = evaluatePassword('');
    expect(res1.score).toBe(0);
    expect(res1.label).toBe('Too short');

    const res2 = evaluatePassword('password');
    expect(res2.score).toBeLessThanOrEqual(1);

    const res3 = evaluatePassword('123456');
    expect(res3.score).toBeLessThanOrEqual(1);
  });

  it('rewards long multi-word passphrases', () => {
    const res = evaluatePassword('correct horse battery staple');
    expect(res.score).toBeGreaterThanOrEqual(3);
    expect(res.crackTime).toBeDefined();
  });

  it('penalizes user inputs (email / name) in password', () => {
    const withoutInput = evaluatePassword('aliceSecretKey123!');
    const withInput = evaluatePassword('aliceSecretKey123!', ['alice']);
    expect(withInput.score).toBeLessThanOrEqual(withoutInput.score);
  });
});

describe('client HIBP breach check (k-anonymity)', () => {
  it('sends only the first 5 hex chars to HIBP API', async () => {
    let requestedUrl = '';
    const mockFetch = vi.fn().mockImplementation((url) => {
      requestedUrl = url;
      // return a response containing a matching suffix
      // SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
      // prefix = 5BAA6, suffix = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('1E4C9B93F3F0682250B6CF8331B7EE68FD8:3861493\r\n0018A45C4D63AE5D13F7604F2001F439B26:1'),
      });
    });

    globalThis.fetch = mockFetch;

    const result = await checkBreach('password');
    expect(requestedUrl).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(result.breached).toBe(true);
    expect(result.count).toBe(3861493);
  });

  it('returns breached: false when suffix is not in response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('ABCDEF1234567890ABCDEF1234567890ABCDEF12:5\r\n'),
    });

    const result = await checkBreach('verySecurePassphraseThatIsNotBreached123!');
    expect(result.breached).toBe(false);
    expect(result.count).toBe(0);
  });
});
