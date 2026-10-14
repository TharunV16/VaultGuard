// @ts-check
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { Challenge } from '../src/models/Challenge.js';
import { hashAuthKey } from '../lib/crypto.js';

let mongod;
let app;
let server;
let baseUrl;

before(async () => {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vaultguard_test';
  await mongoose.connect(uri);

  app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve(null);
    });
  });
});

after(async () => {
  if (server) server.close();
  await mongoose.disconnect();
});

beforeEach(async () => {
  await User.deleteMany({});
  await Session.deleteMany({});
  await Challenge.deleteMany({});
});

describe('POST /api/v1/auth/prelogin', () => {
  it('returns KDF params for existing user', async () => {
    const authHash = await hashAuthKey('00'.repeat(32));
    await User.create({
      email: 'test@vaultguard.local',
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'aa'.repeat(16) },
      authHash,
      wrappedVaultKey: { iv: '00'.repeat(12), ct: 'ff' },
      recoveryWrappedVaultKey: { iv: '00'.repeat(12), ct: 'ff' },
      recoveryVerifierHash: '11'.repeat(32),
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/prelogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@vaultguard.local' }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.kdf.salt, 'aa'.repeat(16));
    assert.equal(data.kdf.iterations, 600000);
  });

  it('returns decoy KDF params for unknown user (enumeration defense)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/prelogin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'unknown@vaultguard.local' }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.kdf.algo, 'PBKDF2-SHA256');
    assert.equal(data.kdf.iterations, 600000);
    assert.equal(data.kdf.salt.length, 32);
  });
});

describe('POST /api/v1/auth/register', () => {
  const validPayload = {
    email: 'newuser@vaultguard.local',
    authKey: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    kdf: {
      algo: 'PBKDF2-SHA256',
      iterations: 600000,
      salt: '0123456789abcdef0123456789abcdef',
    },
    wrappedVaultKey: {
      iv: '0123456789abcdef01234567',
      ct: 'deadbeefcafebabe',
    },
    recoveryWrappedVaultKey: {
      iv: '0123456789abcdef01234567',
      ct: 'feedfacecafebeef',
    },
    recoveryVerifier: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
  };

  it('registers new user and returns 202', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    assert.equal(res.status, 202);
    const u = await User.findOne({ email: 'newuser@vaultguard.local' });
    assert.ok(u);
    assert.equal(u.emailVerified, false);

    const ch = await Challenge.findOne({ userId: u._id, purpose: 'email_verify' });
    assert.ok(ch);
  });

  it('rejects NoSQL injection operator objects via zod validation', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validPayload,
        email: { $ne: null },
      }),
    });

    assert.equal(res.status, 400);
  });

  it('returns generic 202 on duplicate registration without overwriting', async () => {
    await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });

    assert.equal(res.status, 202);
    const count = await User.countDocuments({ email: 'newuser@vaultguard.local' });
    assert.equal(count, 1);
  });
});

describe('POST /api/v1/auth/login and sessions', () => {
  const authKeyHex = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

  beforeEach(async () => {
    const authHash = await hashAuthKey(authKeyHex);
    await User.create({
      email: 'user@vaultguard.local',
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'aa'.repeat(16) },
      authHash,
      wrappedVaultKey: { iv: '00'.repeat(12), ct: 'abcd' },
      recoveryWrappedVaultKey: { iv: '00'.repeat(12), ct: 'abcd' },
      recoveryVerifierHash: '11'.repeat(32),
    });
  });

  it('logs in successfully and sets HttpOnly refresh cookie', async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@vaultguard.local', authKey: authKeyHex }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.accessToken);
    assert.equal(data.wrappedVaultKey.ct, 'abcd');

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.match(setCookie, /refresh_token=/);
    assert.match(setCookie, /HttpOnly/i);
  });

  it('rejects incorrect authKey with generic 401', async () => {
    const wrongAuthKey = '99'.repeat(32);
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@vaultguard.local', authKey: wrongAuthKey }),
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error.code, 'INVALID_CREDENTIALS');
  });

  it('enforces progressive lockout after 5 failed attempts', async () => {
    const wrongAuthKey = '99'.repeat(32);
    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@vaultguard.local', authKey: wrongAuthKey }),
      });
    }

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@vaultguard.local', authKey: authKeyHex }),
    });

    assert.equal(res.status, 429);
    const data = await res.json();
    assert.equal(data.error.code, 'LOCKED_OUT');
    assert.ok(data.error.retryAfter > 0);
  });
});

describe('Refresh token rotation and reuse detection (AUTH-05)', () => {
  const authKeyHex = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

  beforeEach(async () => {
    const authHash = await hashAuthKey(authKeyHex);
    await User.create({
      email: 'user@vaultguard.local',
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'aa'.repeat(16) },
      authHash,
      wrappedVaultKey: { iv: '00'.repeat(12), ct: 'abcd' },
      recoveryWrappedVaultKey: { iv: '00'.repeat(12), ct: 'abcd' },
      recoveryVerifierHash: '11'.repeat(32),
    });
  });

  it('rotates refresh token and invalidates family on reuse', async () => {
    // 1. Initial login
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@vaultguard.local', authKey: authKeyHex }),
    });

    const cookie1 = loginRes.headers.get('set-cookie');
    assert.ok(cookie1);
    const token1Match = cookie1.match(/refresh_token=([^;]+)/);
    const token1 = token1Match ? token1Match[1] : '';

    // 2. Normal refresh with token1
    const refreshRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${token1}` },
    });

    assert.equal(refreshRes.status, 200);
    const cookie2 = refreshRes.headers.get('set-cookie');
    assert.ok(cookie2);
    const token2Match = cookie2.match(/refresh_token=([^;]+)/);
    const token2 = token2Match ? token2Match[1] : '';
    assert.notEqual(token1, token2); // Token rotated!

    // 3. REUSE ATTACK: presenting old token1 again
    const reuseRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${token1}` },
    });

    assert.equal(reuseRes.status, 401);
    const reuseData = await reuseRes.json();
    assert.equal(reuseData.error.code, 'TOKEN_REUSED');

    // 4. Verify that token2 is NOW ALSO REVOKED (family revoked)
    const victimRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refresh_token=${token2}` },
    });
    assert.equal(victimRes.status, 401);
  });
});
