#!/usr/bin/env node
/**
 * smoke.mjs — End-to-end smoke test for VaultGuard
 * Exercises: register → verify email → login → enable TOTP → login with MFA
 *           → create item → sync → recovery
 *
 * Usage: BASE_URL=http://localhost:5000 node scripts/smoke.mjs
 */

import { webcrypto } from 'node:crypto';
import { generateTotpCode } from '../server/lib/totp.js';

const crypto = webcrypto;
let BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:5000';
let serverInstance = null;
let mongodInstance = null;

function log(step, msg) {
  console.log(`[smoke] [${step}] ${msg}`);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveMasterKey(password, salt) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    base,
    256
  );
  return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
}

async function deriveAuthKey(masterKey) {
  const enc = new TextEncoder();
  const derived = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('vg-auth') },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt']
  );
  const raw = await crypto.subtle.exportKey('raw', derived);
  return toHex(raw);
}

async function deriveWrapKey(masterKey) {
  const enc = new TextEncoder();
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode('vg-enc') },
    masterKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

async function runSmoke() {
  // Check if target server is live; if not, spin up an in-process instance
  try {
    const probe = await fetch(`${BASE_URL}/api/v1/health`, { signal: AbortSignal.timeout(1500) });
    if (probe.ok) {
      log('SETUP', `Connected to running server at ${BASE_URL}`);
    } else {
      throw new Error(`Probe returned ${probe.status}`);
    }
  } catch {
    log('SETUP', `No active server found at ${BASE_URL}. Starting in-process server with MongoMemoryServer...`);
    if (!process.env.JWT_ACCESS_SECRET) {
      process.env.NODE_ENV = 'test';
      process.env.PORT = '5001';
      process.env.CLIENT_ORIGIN = 'http://localhost:5173';
      process.env.JWT_ACCESS_SECRET = 'testjwtsecretthatisforciuseonly1234567890abcdef1234567890abcdef';
      process.env.SERVER_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
      process.env.DECOY_SECRET = 'testdecoy1234567890123456789012';
      process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/vaultguard_test';
    }
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongoose = (await import('mongoose')).default;
    const { createApp } = await import('../server/src/app.js');

    mongodInstance = await MongoMemoryServer.create();
    await mongoose.connect(mongodInstance.getUri());
    const app = createApp();

    await new Promise((resolve) => {
      serverInstance = app.listen(0, '127.0.0.1', () => {
        BASE_URL = `http://127.0.0.1:${serverInstance.address().port}`;
        resolve(null);
      });
    });
    log('SETUP', `In-process test server running at ${BASE_URL}`);
  }

  log('START', `Running VaultGuard end-to-end smoke test against ${BASE_URL}`);

  // 1. Health check
  const healthRes = await fetch(`${BASE_URL}/api/v1/health`);
  if (!healthRes.ok) throw new Error(`Health check failed: ${healthRes.status}`);
  log('1/8', 'Health check passed (200 OK)');

  // 2. Register
  const email = `smoke_${Date.now()}@vaultguard.local`;
  const password = 'Correct-Horse-Battery-Staple-2026!';
  const kdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const masterKey = await deriveMasterKey(password, kdfSalt);
  const authKey = await deriveAuthKey(masterKey);
  const wrapKey = await deriveWrapKey(masterKey);

  const vaultKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const wrappedVaultKeyIv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedVaultKeyCt = await crypto.subtle.wrapKey('raw', vaultKey, wrapKey, {
    name: 'AES-GCM',
    iv: wrappedVaultKeyIv,
  });

  const regRes = await fetch(`${BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      authKey,
      kdf: {
        algo: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: toHex(kdfSalt),
      },
      wrappedVaultKey: {
        iv: toHex(wrappedVaultKeyIv),
        ct: toHex(wrappedVaultKeyCt),
      },
      recoveryWrappedVaultKey: {
        iv: toHex(wrappedVaultKeyIv),
        ct: toHex(wrappedVaultKeyCt),
      },
      recoveryVerifier: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }),
  });
  if (regRes.status !== 202) {
    const errText = await regRes.text();
    throw new Error(`Registration failed (${regRes.status}): ${errText}`);
  }
  log('2/8', `Registered user ${email} (202 Accepted)`);

  // 3. Verify Email
  const codeRes = await fetch(`${BASE_URL}/api/v1/auth/test-hook/code?email=${encodeURIComponent(email)}&purpose=email_verify`);
  const { code: verifyCode } = await codeRes.json();
  if (!verifyCode) throw new Error('Failed to retrieve email verification code from test hook');

  const verifyRes = await fetch(`${BASE_URL}/api/v1/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: verifyCode }),
  });
  if (!verifyRes.ok) throw new Error(`Email verification failed: ${verifyRes.status}`);
  log('3/8', `Verified email with code ${verifyCode} (200 OK)`);

  // 4. Initial Login
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, authKey }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  let { accessToken } = await loginRes.json();
  log('4/8', 'Initial login successful, access token acquired');

  // 5. Setup & Enable TOTP MFA
  const totpSetupRes = await fetch(`${BASE_URL}/api/v1/mfa/totp/setup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!totpSetupRes.ok) throw new Error(`TOTP setup failed: ${totpSetupRes.status}`);
  const { secret: totpSecret } = await totpSetupRes.json();

  const totpCode = generateTotpCode(totpSecret);
  const totpEnableRes = await fetch(`${BASE_URL}/api/v1/mfa/totp/enable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code: totpCode }),
  });
  if (!totpEnableRes.ok) throw new Error(`TOTP enable failed: ${totpEnableRes.status}`);
  const { backupCodes } = await totpEnableRes.json();
  log('5/8', 'TOTP MFA enabled and backup codes generated');

  // 6. Login with MFA Challenge
  const mfaLoginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, authKey }),
  });
  const mfaLoginData = await mfaLoginRes.json();
  if (!mfaLoginData.mfaRequired || !mfaLoginData.mfaToken) {
    throw new Error('Expected MFA challenge during login');
  }

  // Use next step window (+30s) to adhere to RFC 6238 anti-replay policy
  const freshTotpCode = generateTotpCode(totpSecret, Math.floor(Date.now() / 1000) + 30);
  const mfaVerifyRes = await fetch(`${BASE_URL}/api/v1/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mfaToken: mfaLoginData.mfaToken,
      method: 'totp',
      code: freshTotpCode,
    }),
  });
  if (!mfaVerifyRes.ok) throw new Error(`MFA verification failed: ${mfaVerifyRes.status}`);
  const mfaSuccessData = await mfaVerifyRes.json();
  accessToken = mfaSuccessData.accessToken;
  log('6/8', 'MFA challenge completed; authenticated successfully');

  // 7. Create Item & Sync Vault
  const itemIv = crypto.getRandomValues(new Uint8Array(12));
  const itemCt = '00112233445566778899aabbccddeeff';
  const itemCreateRes = await fetch(`${BASE_URL}/api/v1/vault/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ iv: toHex(itemIv), ct: itemCt }),
  });
  if (itemCreateRes.status !== 201) throw new Error(`Item creation failed: ${itemCreateRes.status}`);
  const { item: createdItem } = await itemCreateRes.json();

  const syncRes = await fetch(`${BASE_URL}/api/v1/vault/sync`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!syncRes.ok) throw new Error(`Vault sync failed: ${syncRes.status}`);
  const syncData = await syncRes.json();
  const foundItem = syncData.items.find((i) => i._id === createdItem._id);
  if (!foundItem) throw new Error('Created item not found in vault sync');
  log('7/8', `Created encrypted vault item (${createdItem._id}) and verified via sync`);

  // 8. Account Recovery flow
  const recStartRes = await fetch(`${BASE_URL}/api/v1/auth/recovery/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (recStartRes.status !== 202) throw new Error(`Recovery start failed: ${recStartRes.status}`);

  const recTokenRes = await fetch(`${BASE_URL}/api/v1/auth/test-hook/code?email=${encodeURIComponent(email)}&purpose=recovery`);
  const { code: recoveryLinkToken } = await recTokenRes.json();
  if (!recoveryLinkToken) throw new Error('Failed to retrieve recovery link token');

  // Verify recovery using emergency backup code
  const recVerifyRes = await fetch(`${BASE_URL}/api/v1/auth/recovery/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      token: recoveryLinkToken,
      method: 'backup_code',
      code: backupCodes[0],
    }),
  });
  if (!recVerifyRes.ok) throw new Error(`Recovery verify failed: ${recVerifyRes.status}`);
  const { recoveryToken } = await recVerifyRes.json();

  // Set new master password
  const newPassword = 'Brand-New-Master-Password-2026!';
  const newKdfSalt = crypto.getRandomValues(new Uint8Array(16));
  const newMasterKey = await deriveMasterKey(newPassword, newKdfSalt);
  const newAuthKey = await deriveAuthKey(newMasterKey);
  const newWrapKey = await deriveWrapKey(newMasterKey);
  const newWrappedVaultKey = await crypto.subtle.wrapKey('raw', vaultKey, newWrapKey, {
    name: 'AES-GCM',
    iv: wrappedVaultKeyIv,
  });

  const recCompleteRes = await fetch(`${BASE_URL}/api/v1/auth/recovery/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recoveryToken,
      recoveryVerifier: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      newAuthKey,
      newKdf: {
        algo: 'PBKDF2-SHA256',
        iterations: 600000,
        salt: toHex(newKdfSalt),
      },
      newWrappedVaultKey: {
        iv: toHex(wrappedVaultKeyIv),
        ct: toHex(newWrappedVaultKey),
      },
      newRecoveryWrappedVaultKey: {
        iv: toHex(wrappedVaultKeyIv),
        ct: toHex(newWrappedVaultKey),
      },
      newRecoveryVerifier: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    }),
  });
  if (!recCompleteRes.ok) {
    const errText = await recCompleteRes.text();
    throw new Error(`Recovery complete failed (${recCompleteRes.status}): ${errText}`);
  }

  // Test login with new credentials + MFA
  const newLoginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, authKey: newAuthKey }),
  });
  const newLoginData = await newLoginRes.json();
  if (!newLoginData.mfaRequired) throw new Error('Expected MFA prompt after recovery');

  const finalAuthRes = await fetch(`${BASE_URL}/api/v1/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mfaToken: newLoginData.mfaToken,
      method: 'backup_code',
      code: backupCodes[1],
    }),
  });
  if (!finalAuthRes.ok) throw new Error(`Final login failed: ${finalAuthRes.status}`);
  log('8/8', 'Account recovery succeeded and verified login with new credentials');

  log('SUCCESS', 'All smoke test stages passed cleanly! ✅');

  if (serverInstance) {
    await new Promise((res) => serverInstance.close(res));
  }
  if (mongodInstance) {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
    await mongodInstance.stop();
  }
  process.exit(0);
}

runSmoke().catch(async (err) => {
  console.error('[smoke] [FATAL]', err);
  if (serverInstance) await new Promise((res) => serverInstance.close(res));
  if (mongodInstance) {
    const mongoose = (await import('mongoose')).default;
    await mongoose.disconnect();
    await mongodInstance.stop();
  }
  process.exit(1);
});
