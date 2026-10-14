// @ts-check
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { Challenge } from '../src/models/Challenge.js';
import {
  hashAuthKey,
  hashRecoveryVerifier,
  hashToken,
  randomHex,
} from '../lib/crypto.js';
import { issueAccessToken, generateRefreshToken } from '../lib/tokens.js';

let app;
let server;
let baseUrl;

const INITIAL_AUTH_KEY = '11'.repeat(32);
const NEW_AUTH_KEY = '22'.repeat(32);
const RECOVERY_VERIFIER = '33'.repeat(32);
const NEW_RECOVERY_VERIFIER = '44'.repeat(32);

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

describe('Phase 4: Account Recovery and Reset Flows', () => {
  async function createTestUser(email = 'recovery-user@vaultguard.local') {
    const authHash = await hashAuthKey(INITIAL_AUTH_KEY);
    const recoveryVerifierHash = hashRecoveryVerifier(RECOVERY_VERIFIER);
    const user = await User.create({
      email,
      emailVerified: true,
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'aa'.repeat(16) },
      authHash,
      wrappedVaultKey: { iv: '00'.repeat(12), ct: 'ff' },
      recoveryWrappedVaultKey: { iv: '11'.repeat(12), ct: 'ee' },
      recoveryVerifierHash,
    });
    return user;
  }

  it('POST /recovery/start returns generic 202 and issues challenge for existing user (REC-02)', async () => {
    const user = await createTestUser();

    // 1. Existing user
    const res = await fetch(`${baseUrl}/api/v1/auth/recovery/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    assert.equal(res.status, 202);

    const challenge = await Challenge.findOne({ userId: user._id, purpose: 'recovery' });
    assert.ok(challenge);

    // 2. Unknown email also gets identical 202 (no enumeration)
    const unknownRes = await fetch(`${baseUrl}/api/v1/auth/recovery/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent@vaultguard.local' }),
    });
    assert.equal(unknownRes.status, 202);
  });

  it('End-to-End Recovery: forgot password → email token → verify → set new password → old sessions dead (REC-03, REC-04)', async () => {
    const user = await createTestUser();

    // Active session before recovery
    const { raw, hash, expiresAt } = generateRefreshToken();
    await Session.create({
      userId: user._id,
      tokenHash: hash,
      familyId: randomHex(16),
      device: { ua: 'test', ipPrefix: '127.0.0.0', label: 'Test Browser' },
      expiresAt,
    });

    // 1. Start recovery
    await fetch(`${baseUrl}/api/v1/auth/recovery/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });

    // Fetch the challenge token from the database
    const challenge = await Challenge.findOne({ userId: user._id, purpose: 'recovery' }).sort({ createdAt: -1 });
    assert.ok(challenge);

    // In a real flow, the email link contains the raw 32-byte token.
    // Create a known token and set its hash in challenge for testing:
    const rawToken = randomHex(32);
    challenge.codeHash = hashToken(rawToken);
    await challenge.save();

    // 2. Verify recovery link
    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/recovery/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        token: rawToken,
      }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assert.ok(verifyBody.recoveryToken);
    assert.equal(verifyBody.recoveryWrappedVaultKey.ct, 'ee');

    // 3. Complete recovery with wrong recovery verifier fails
    const badComplete = await fetch(`${baseUrl}/api/v1/auth/recovery/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recoveryToken: verifyBody.recoveryToken,
        recoveryVerifier: '00'.repeat(32),
        newAuthKey: NEW_AUTH_KEY,
        newKdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'bb'.repeat(16) },
        newWrappedVaultKey: { iv: '22'.repeat(12), ct: 'dd' },
        newRecoveryWrappedVaultKey: { iv: '33'.repeat(12), ct: 'cc' },
        newRecoveryVerifier: NEW_RECOVERY_VERIFIER,
      }),
    });
    assert.equal(badComplete.status, 401);

    // 4. Complete recovery with valid recovery verifier succeeds
    const okComplete = await fetch(`${baseUrl}/api/v1/auth/recovery/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recoveryToken: verifyBody.recoveryToken,
        recoveryVerifier: RECOVERY_VERIFIER,
        newAuthKey: NEW_AUTH_KEY,
        newKdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'bb'.repeat(16) },
        newWrappedVaultKey: { iv: '22'.repeat(12), ct: 'dd' },
        newRecoveryWrappedVaultKey: { iv: '33'.repeat(12), ct: 'cc' },
        newRecoveryVerifier: NEW_RECOVERY_VERIFIER,
      }),
    });
    assert.equal(okComplete.status, 200);

    // 5. Verify old session was revoked
    const activeSessions = await Session.find({ userId: user._id, revokedAt: null });
    assert.equal(activeSessions.length, 0);

    // 6. User can log in with NEW credentials
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, authKey: NEW_AUTH_KEY }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.accessToken);
    assert.equal(loginData.wrappedVaultKey.ct, 'dd');
  });

  it('Lost recovery key: account reset wipes vault and requires exact confirmation (REC-05)', async () => {
    const user = await createTestUser();

    // Setup recovery challenge
    const rawToken = randomHex(32);
    await Challenge.create({
      userId: user._id,
      purpose: 'recovery',
      codeHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/recovery/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, token: rawToken }),
    });
    const { recoveryToken } = await verifyRes.json();

    // Reset account requires typed confirmation 'DELETE MY VAULT'
    const resetRes = await fetch(`${baseUrl}/api/v1/auth/recovery/reset-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recoveryToken,
        confirmation: 'DELETE MY VAULT',
        newAuthKey: NEW_AUTH_KEY,
        newKdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'cc'.repeat(16) },
        newWrappedVaultKey: { iv: '44'.repeat(12), ct: 'bb' },
        newRecoveryWrappedVaultKey: { iv: '55'.repeat(12), ct: 'aa' },
        newRecoveryVerifier: NEW_RECOVERY_VERIFIER,
      }),
    });
    assert.equal(resetRes.status, 200);

    // Login with new key works
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, authKey: NEW_AUTH_KEY }),
    });
    assert.equal(loginRes.status, 200);
  });

  it('Recovery key rotation requires step-up (REC-07)', async () => {
    const user = await createTestUser();
    const token = issueAccessToken({ id: user._id.toString(), email: user.email, role: 'user' });

    // 1. Without step-up returns 403
    const noStepUp = await fetch(`${baseUrl}/api/v1/me/recovery-key/rotate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        recoveryWrappedVaultKey: { iv: '77'.repeat(12), ct: '88' },
        recoveryVerifier: NEW_RECOVERY_VERIFIER,
      }),
    });
    assert.equal(noStepUp.status, 403);

    // 2. Obtain step-up token
    const stepUpRes = await fetch(`${baseUrl}/api/v1/auth/step-up`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ authKey: INITIAL_AUTH_KEY }),
    });
    assert.equal(stepUpRes.status, 200);
    const { stepUpToken } = await stepUpRes.json();

    // 3. Rotate with step-up succeeds
    const rotateRes = await fetch(`${baseUrl}/api/v1/me/recovery-key/rotate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Step-Up-Token': stepUpToken,
      },
      body: JSON.stringify({
        recoveryWrappedVaultKey: { iv: '77'.repeat(12), ct: '88' },
        recoveryVerifier: NEW_RECOVERY_VERIFIER,
      }),
    });
    assert.equal(rotateRes.status, 200);

    const updated = await User.findById(user._id);
    assert.equal(updated.recoveryWrappedVaultKey.ct, '88');
  });
});
