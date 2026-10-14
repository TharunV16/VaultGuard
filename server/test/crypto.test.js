// server/test/crypto.test.js
// node:test — tests for server/lib/crypto.js and server/lib/totp.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashAuthKey, verifyAuthKey, encryptServerData, decryptServerData, safeEqual, randomHex } from '../lib/crypto.js';
import { verifyTotp, generateTotpSecret } from '../lib/totp.js';

// ── server/lib/crypto.js ──────────────────────────────────────────────────────

describe('hashAuthKey / verifyAuthKey', () => {
  it('round-trips successfully', async () => {
    const authKeyHex = randomHex(32);
    const { salt, hash } = await hashAuthKey(authKeyHex);
    const ok = await verifyAuthKey(authKeyHex, salt, hash);
    assert.equal(ok, true);
  });

  it('rejects wrong authKey', async () => {
    const authKeyHex = randomHex(32);
    const { salt, hash } = await hashAuthKey(authKeyHex);
    const ok = await verifyAuthKey(randomHex(32), salt, hash);
    assert.equal(ok, false);
  });
});

describe('encryptServerData / decryptServerData', () => {
  it('round-trips plaintext', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP'; // example TOTP secret
    const enc = encryptServerData(plaintext);
    const dec = decryptServerData(enc);
    assert.equal(dec, plaintext);
  });

  it('rejects tampered ciphertext', () => {
    const enc = encryptServerData('sensitive');
    // flip one byte of ciphertext
    const ctBuf = Buffer.from(enc.ct, 'hex');
    ctBuf[0] ^= 0xff;
    const tampered = { ...enc, ct: ctBuf.toString('hex') };
    assert.throws(() => decryptServerData(tampered));
  });

  it('rejects tampered auth tag', () => {
    const enc = encryptServerData('sensitive');
    const tagBuf = Buffer.from(enc.tag, 'hex');
    tagBuf[0] ^= 0xff;
    const tampered = { ...enc, tag: tagBuf.toString('hex') };
    assert.throws(() => decryptServerData(tampered));
  });
});

describe('safeEqual', () => {
  it('returns true for equal hex strings', () => {
    const h = randomHex(32);
    assert.equal(safeEqual(h, h), true);
  });

  it('returns false for different hex strings of same length', () => {
    assert.equal(safeEqual(randomHex(32), randomHex(32)), false);
  });

  it('returns false for different lengths', () => {
    assert.equal(safeEqual(randomHex(16), randomHex(32)), false);
  });
});

// ── server/lib/totp.js — RFC 6238 vectors ────────────────────────────────────

describe('TOTP RFC 6238 test vectors (SHA-1)', () => {
  // Secret for RFC 6238 test vectors is ASCII "12345678901234567890" = 20 bytes
  // The TOTP secret must be passed as Base32. We encode "12345678901234567890".
  const RFC_SECRET_ASCII = '12345678901234567890';
  const rfc_secret_bytes = Buffer.from(RFC_SECRET_ASCII, 'ascii');

  // Manual Base32 encode of those bytes
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function toBase32(buf) {
    let bits = 0, value = 0, out = '';
    for (const byte of buf) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 0x1f]; bits -= 5; }
    }
    if (bits > 0) out += B32[(value << (5 - bits)) & 0x1f];
    return out;
  }
  const secretBase32 = toBase32(rfc_secret_bytes);

  // RFC 6238 Appendix B vectors (SHA-1, 6 digits, period=30s)
  const vectors = [
    { unixTime: 59,         expected: '287082' },
    { unixTime: 1111111109, expected: '081804' },
    { unixTime: 1111111111, expected: '050471' },
    { unixTime: 1234567890, expected: '005924' },
    { unixTime: 2000000000, expected: '279037' },
  ];

  for (const { unixTime, expected } of vectors) {
    it(`T=${unixTime} → ${expected}`, () => {
      const { valid } = verifyTotp(secretBase32, expected, unixTime);
      assert.equal(valid, true, `Expected TOTP ${expected} at T=${unixTime} to verify`);
    });
  }

  it('rejects a wrong code', () => {
    const { valid } = verifyTotp(secretBase32, '000000', 59);
    assert.equal(valid, false);
  });
});

describe('generateTotpSecret', () => {
  it('returns a non-empty base32 string', () => {
    const s = generateTotpSecret();
    assert.ok(s.length > 0);
    assert.match(s, /^[A-Z2-7]+$/);
  });
});
