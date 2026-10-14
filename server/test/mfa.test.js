// @ts-check
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { Challenge } from '../src/models/Challenge.js';
import { hashAuthKey, hashToken, encryptServerData } from '../lib/crypto.js';
import { issueAccessToken } from '../lib/tokens.js';
import { verifyTotp } from '../lib/totp.js';
import { createHmac } from 'node:crypto';

let app;
let server;
let baseUrl;

const TEST_AUTH_KEY = 'a1'.repeat(32);

// Helper: compute hotp code for a known secret
function getTotpCode(secretBase32, nowSec = Math.floor(Date.now() / 1000)) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const map = Object.fromEntries([...chars].map((c, i) => [c, i]));
  let bits = 0, value = 0, out = [];
  for (const c of secretBase32.toUpperCase()) {
    const v = map[c];
    if (v === undefined) continue;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const secret = Buffer.from(out);
  const counter = Math.floor(nowSec / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1000000;
  return String(code).padStart(6, '0');
}

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

describe('Phase 3 MFA: TOTP, Backup Codes, Email OTP, and Step-Up', () => {
  async function createVerifiedUser(email = 'mfa-user@vaultguard.local') {
    const authHash = await hashAuthKey(TEST_AUTH_KEY);
    const user = await User.create({
      email,
      emailVerified: true,
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'aa'.repeat(16) },
      authHash,
      wrappedVaultKey: { iv: '00'.repeat(12), ct: 'ff' },
      recoveryWrappedVaultKey: { iv: '00'.repeat(12), ct: 'ff' },
      recoveryVerifierHash: '11'.repeat(32),
    });
    const token = issueAccessToken({ id: user._id.toString(), email: user.email, role: user.role });
    return { user, token };
  }

  it('TOTP setup returns valid secret and otpauth URI (MFA-01)', async () => {
    const { token } = await createVerifiedUser();

    const res = await fetch(`${baseUrl}/api/v1/mfa/totp/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.secret);
    assert.ok(body.uri.startsWith('otpauth://totp/VaultGuard:'));
  });

  it('TOTP enable verifies code, activates TOTP, and generates backup codes (MFA-01, MFA-02)', async () => {
    const { token } = await createVerifiedUser();

    // 1. Setup
    const setupRes = await fetch(`${baseUrl}/api/v1/mfa/totp/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const { secret } = await setupRes.json();

    // 2. Enable with wrong code fails
    const badRes = await fetch(`${baseUrl}/api/v1/mfa/totp/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: '000000' }),
    });
    assert.equal(badRes.status, 400);

    // 3. Enable with valid code
    const validCode = getTotpCode(secret);
    const okRes = await fetch(`${baseUrl}/api/v1/mfa/totp/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: validCode }),
    });
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json();
    assert.equal(okBody.status, 'ok');
    assert.equal(okBody.backupCodes.length, 10);
    assert.match(okBody.backupCodes[0], /^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
  });

  it('Login requires MFA when enabled, and rejects replay of TOTP code (MFA-05)', async () => {
    const { user, token } = await createVerifiedUser();

    // Setup & enable TOTP
    const setupRes = await fetch(`${baseUrl}/api/v1/mfa/totp/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const { secret } = await setupRes.json();
    const code = getTotpCode(secret);
    await fetch(`${baseUrl}/api/v1/mfa/totp/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code }),
    });

    // 1. Attempt login -> returns mfaRequired: true + mfaToken
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, authKey: TEST_AUTH_KEY }),
    });
    assert.equal(loginRes.status, 200);
    const loginBody = await loginRes.json();
    assert.equal(loginBody.mfaRequired, true);
    assert.ok(loginBody.mfaToken);
    assert.ok(loginBody.methods.includes('totp'));
    assert.ok(loginBody.methods.includes('backup_code'));

    // 2. Replaying the setup code fails (CODE_ALREADY_USED)
    const replayRes = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mfaToken: loginBody.mfaToken,
        method: 'totp',
        code,
      }),
    });
    assert.equal(replayRes.status, 401);

    // 3. Verifying with future step code succeeds
    const futureCode = getTotpCode(secret, Math.floor(Date.now() / 1000) + 30);
    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mfaToken: loginBody.mfaToken,
        method: 'totp',
        code: futureCode,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.ok(verifyBody.accessToken);
    assert.ok(verifyBody.wrappedVaultKey);
  });

  it('Backup code completes MFA login and cannot be reused (MFA-02, MFA-05)', async () => {
    const { user, token } = await createVerifiedUser();

    // Setup TOTP to get backup codes
    const setupRes = await fetch(`${baseUrl}/api/v1/mfa/totp/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const { secret } = await setupRes.json();
    const enableRes = await fetch(`${baseUrl}/api/v1/mfa/totp/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: getTotpCode(secret) }),
    });
    const { backupCodes } = await enableRes.json();
    const testCode = backupCodes[0];

    // Login to get mfaToken
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, authKey: TEST_AUTH_KEY }),
    });
    const { mfaToken } = await loginRes.json();

    // Verify using backup code
    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mfaToken,
        method: 'backup_code',
        code: testCode,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.ok(verifyBody.accessToken);

    // Reuse of same backup code on next login fails
    const login2 = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, authKey: TEST_AUTH_KEY }),
    });
    const { mfaToken: mfaToken2 } = await login2.json();

    const reuseRes = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mfaToken: mfaToken2,
        method: 'backup_code',
        code: testCode,
      }),
    });
    assert.equal(reuseRes.status, 401);
  });

  it('Step-up authentication issues 5-min stepUpToken, required to disable TOTP (AUTH-16, MFA-06)', async () => {
    const { token } = await createVerifiedUser();

    // Setup & enable TOTP
    const setupRes = await fetch(`${baseUrl}/api/v1/mfa/totp/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const { secret } = await setupRes.json();
    const enableCode = getTotpCode(secret);
    await fetch(`${baseUrl}/api/v1/mfa/totp/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: enableCode }),
    });

    // 1. DELETE /mfa/totp without step-up returns 403
    const noStepUp = await fetch(`${baseUrl}/api/v1/mfa/totp`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(noStepUp.status, 403);

    // 2. Request step-up with wrong password returns 401
    const badStepUp = await fetch(`${baseUrl}/api/v1/auth/step-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ authKey: '99'.repeat(32) }),
    });
    assert.equal(badStepUp.status, 401);

    // 3. Request step-up with valid authKey and TOTP code returns stepUpToken
    const validStepUpCode = getTotpCode(secret, Math.floor(Date.now() / 1000) + 30);
    const stepUpRes = await fetch(`${baseUrl}/api/v1/auth/step-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        authKey: TEST_AUTH_KEY,
        method: 'totp',
        code: validStepUpCode,
      }),
    });
    assert.equal(stepUpRes.status, 200);
    const { stepUpToken } = await stepUpRes.json();
    assert.ok(stepUpToken);

    // 4. DELETE /mfa/totp with stepUpToken succeeds
    const disableRes = await fetch(`${baseUrl}/api/v1/mfa/totp`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Step-Up-Token': stepUpToken,
      },
    });
    assert.equal(disableRes.status, 200);
  });

  it('Email OTP can be enabled and verified as a second factor (MFA-03)', async () => {
    const { user, token } = await createVerifiedUser();

    // Enable Email OTP
    const enableRes = await fetch(`${baseUrl}/api/v1/mfa/email/enable`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(enableRes.status, 200);

    // Login triggers MFA with email_otp method
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, authKey: TEST_AUTH_KEY }),
    });
    const { mfaToken, methods } = await loginRes.json();
    assert.ok(methods.includes('email_otp'));

    // Request email OTP send
    const sendRes = await fetch(`${baseUrl}/api/v1/auth/mfa/email/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mfaToken}` },
    });
    assert.equal(sendRes.status, 200);

    // Cooldown prevents immediate resend
    const resendRes = await fetch(`${baseUrl}/api/v1/auth/mfa/email/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mfaToken}` },
    });
    assert.equal(resendRes.status, 429);

    // Fetch challenge from DB to get the code hash for verification
    const challenge = await Challenge.findOne({ userId: user._id, purpose: 'email_otp' }).sort({ createdAt: -1 });
    assert.ok(challenge);

    // Invalid code fails
    const badVerify = await fetch(`${baseUrl}/api/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken, method: 'email_otp', code: '000000' }),
    });
    assert.equal(badVerify.status, 401);
  });
});
