// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';
import { Audit } from '../src/models/Audit.js';
import { Item } from '../src/models/Item.js';
import { issueAccessToken, issueStepUpToken } from '../lib/tokens.js';
import { hashAuthKey } from '../lib/crypto.js';

describe('Phase 8: Sessions, Audit, Settings & Account Management', () => {
  let mongod, server, baseUrl;
  let userA, tokenA, stepUpTokenA, userB, tokenB;

  before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve(null);
      });
    });

    const authHashA = await hashAuthKey('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    userA = await User.create({
      email: 'user_a@test.com',
      emailVerified: true,
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      authHash: authHashA,
      wrappedVaultKey: { iv: '000000000000000000000000', ct: 'aabbcc' },
      recoveryWrappedVaultKey: { iv: '000000000000000000000000', ct: 'ddeeff' },
      recoveryVerifierHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'active',
      settings: {
        autoLockMinutes: 5,
        clipboardSeconds: 30,
        theme: 'system',
        breachAutoScan: true,
        snapshotsOptIn: false,
      },
    });
    tokenA = issueAccessToken({ id: userA._id.toString(), email: userA.email, role: 'user' });
    stepUpTokenA = issueStepUpToken({ id: userA._id.toString(), email: userA.email, role: 'user' });

    const authHashB = await hashAuthKey('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    userB = await User.create({
      email: 'user_b@test.com',
      emailVerified: true,
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      authHash: authHashB,
      wrappedVaultKey: { iv: '111111111111111111111111', ct: '112233' },
      recoveryWrappedVaultKey: { iv: '111111111111111111111111', ct: '445566' },
      recoveryVerifierHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      status: 'active',
    });
    tokenB = issueAccessToken({ id: userB._id.toString(), email: userB.email, role: 'user' });
  });

  after(async () => {
    if (server) await new Promise((res) => server.close(res));
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  it('updates user settings and returns new settings (SET-01, SET-02)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        autoLockMinutes: 15,
        clipboardSeconds: 60,
        theme: 'dark',
        breachAutoScan: false,
        snapshotsOptIn: true,
        generatorDefaults: { length: 24, digits: true },
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.equal(data.settings.autoLockMinutes, 15);
    assert.equal(data.settings.clipboardSeconds, 60);
    assert.equal(data.settings.theme, 'dark');
    assert.equal(data.settings.breachAutoScan, false);
    assert.equal(data.settings.snapshotsOptIn, true);
    assert.equal(data.settings.generatorDefaults.length, 24);
  });

  it('lists active sessions and revokes a session with IDOR protection (SES-01)', async () => {
    // Create two sessions for User A and one for User B
    const s1 = await Session.create({
      userId: userA._id,
      tokenHash: 'token_hash_a1',
      familyId: 'family_a1',
      device: { label: 'Chrome on Windows', ipPrefix: '192.168.1.0/24' },
      expiresAt: new Date(Date.now() + 86400000),
    });
    const s2 = await Session.create({
      userId: userA._id,
      tokenHash: 'token_hash_a2',
      familyId: 'family_a2',
      device: { label: 'Firefox on Linux', ipPrefix: '10.0.0.0/24' },
      expiresAt: new Date(Date.now() + 86400000),
    });
    const sB = await Session.create({
      userId: userB._id,
      tokenHash: 'token_hash_b1',
      familyId: 'family_b1',
      device: { label: 'Safari on macOS', ipPrefix: '172.16.0.0/24' },
      expiresAt: new Date(Date.now() + 86400000),
    });

    // List sessions for User A
    const listRes = await fetch(`${baseUrl}/api/v1/me/sessions`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.sessions.length, 2);

    // IDOR test: User A attempts to revoke User B's session -> must return 404
    const idorRes = await fetch(`${baseUrl}/api/v1/me/sessions/${sB._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(idorRes.status, 404);

    // User A revokes session s1 -> must succeed
    const revokeRes = await fetch(`${baseUrl}/api/v1/me/sessions/${s1._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(revokeRes.status, 200);

    const revokedInDb = await Session.findById(s1._id);
    assert.ok(revokedInDb?.revokedAt);

    // Revoke all remaining sessions for User A
    const revokeAllRes = await fetch(`${baseUrl}/api/v1/me/sessions`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(revokeAllRes.status, 200);

    const s2After = await Session.findById(s2._id);
    assert.ok(s2After?.revokedAt);

    // User B's session must remain untouched
    const sBAfter = await Session.findById(sB._id);
    assert.equal(sBAfter?.revokedAt, null);
  });

  it('paginates audit events and filters by event category (AUD-01)', async () => {
    // Insert audit events
    await Audit.create([
      { userId: userA._id, event: 'auth.login', ipPrefix: '192.168.1.0/24', ua: 'Chrome' },
      { userId: userA._id, event: 'auth.login', ipPrefix: '192.168.1.0/24', ua: 'Chrome' },
      { userId: userA._id, event: 'password.change', ipPrefix: '192.168.1.0/24', ua: 'Chrome' },
      { userId: userB._id, event: 'auth.login', ipPrefix: '10.0.0.0/24', ua: 'Firefox' }, // User B event
    ]);

    // Fetch all for User A
    const resAll = await fetch(`${baseUrl}/api/v1/me/audit?page=1&limit=10`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(resAll.status, 200);
    const dataAll = await resAll.json();
    assert.ok(dataAll.total >= 3);
    // User B's audit events must never appear in User A's results (IDOR isolation)
    assert.ok(!dataAll.events.some((e) => e.ua === 'Firefox'));

    // Filter by password.change
    const resFiltered = await fetch(`${baseUrl}/api/v1/me/audit?event=password.change`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(resFiltered.status, 200);
    const dataFiltered = await resFiltered.json();
    assert.equal(dataFiltered.events.length, 1);
    assert.equal(dataFiltered.events[0].event, 'password.change');
  });

  it('changes master password with step-up verification and revokes old sessions (AUTH-15)', async () => {
    // Attempt without step-up -> 403
    const noStepUpRes = await fetch(`${baseUrl}/api/v1/me/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        authKey: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'cccccccccccccccccccccccccccccccc' },
        wrappedVaultKey: { iv: '222222222222222222222222', ct: '334455' },
      }),
    });
    assert.equal(noStepUpRes.status, 403);

    // Create an active session to test revocation
    const activeSession = await Session.create({
      userId: userA._id,
      tokenHash: 'active_session_pre_pw_change',
      familyId: 'family_pre_change',
      expiresAt: new Date(Date.now() + 86400000),
    });

    // Valid change with step-up
    const changeRes = await fetch(`${baseUrl}/api/v1/me/password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
        'x-step-up-token': stepUpTokenA,
      },
      body: JSON.stringify({
        authKey: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'cccccccccccccccccccccccccccccccc' },
        wrappedVaultKey: { iv: '222222222222222222222222', ct: '334455' },
      }),
    });
    assert.equal(changeRes.status, 200);

    const updatedUser = await User.findById(userA._id);
    assert.equal(updatedUser?.wrappedVaultKey.iv, '222222222222222222222222');

    const sessionAfter = await Session.findById(activeSession._id);
    assert.ok(sessionAfter?.revokedAt);
  });

  it('records vault export audit event (VLT-13, AUD-01)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/vault/export-audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        format: 'encrypted_json',
        itemCount: 12,
      }),
    });

    assert.equal(res.status, 200);
    const auditEntry = await Audit.findOne({ userId: userA._id, event: 'export' });
    assert.ok(auditEntry);
    assert.equal(auditEntry.meta.format, 'encrypted_json');
    assert.equal(auditEntry.meta.itemCount, 12);
  });

  it('deletes user account and associated items after step-up and confirmation (AUTH-18)', async () => {
    // Create an item for user A
    await Item.create({
      userId: userA._id,
      iv: '0123456789abcdef01234567',
      ct: 'deadbeef0011',
    });

    // Create fresh step-up token for deletion
    const deleteStepUp = issueStepUpToken({ id: userA._id.toString(), email: userA.email, role: 'user' });

    // Rejects wrong confirmation
    const wrongConfirmRes = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
        'x-step-up-token': deleteStepUp,
      },
      body: JSON.stringify({ confirmation: 'WRONG' }),
    });
    assert.equal(wrongConfirmRes.status, 400);

    // Valid deletion
    const delRes = await fetch(`${baseUrl}/api/v1/me`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
        'x-step-up-token': deleteStepUp,
      },
      body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
    });
    assert.equal(delRes.status, 200);

    // Verify all User A resources wiped
    assert.equal(await User.findById(userA._id), null);
    assert.equal(await Item.countDocuments({ userId: userA._id }), 0);
  });
});
