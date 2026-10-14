// @ts-check
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Send } from '../src/models/Send.js';
import { issueAccessToken } from '../lib/tokens.js';
import { hashAuthKey } from '../lib/crypto.js';

// Helpers — shared with other tests
const HEX24 = '0123456789abcdef01234567'; // 24 hex chars
const HEX_CT = 'deadbeef'.repeat(16);     // 128 hex chars

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function json(res) {
  return res.json();
}

describe('Phase 7: Secure Send', () => {
  let mongod, server, baseUrl;
  let userA, tokenA, userB, tokenB;

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
      email: 'send_a@test.com',
      emailVerified: true,
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.slice(0, 32) },
      authHash: authHashA,
      wrappedVaultKey: { iv: '000000000000000000000000', ct: 'aabbcc' },
      recoveryWrappedVaultKey: { iv: '000000000000000000000000', ct: 'ddeeff' },
      recoveryVerifierHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      status: 'active',
    });
    tokenA = issueAccessToken({ id: userA._id.toString(), email: userA.email, role: 'user' });

    const authHashB = await hashAuthKey('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    userB = await User.create({
      email: 'send_b@test.com',
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
    server?.close();
    await mongoose.disconnect();
    await mongod?.stop();
  });

  // ── Create ──────────────────────────────────────────────────────────────────

  it('creates a send (SND-01)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(tokenA) },
      body: JSON.stringify({ iv: HEX24, ct: HEX_CT, maxViews: 3, expiresIn: '24h' }),
    });
    assert.equal(res.status, 201);
    const body = await json(res);
    assert.ok(body.send._id, 'should have _id');
    assert.equal(body.send.maxViews, 3);
    assert.equal(body.send.views, 0);
  });

  it('rejects create without auth', async () => {
    const res = await fetch(`${baseUrl}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iv: HEX24, ct: HEX_CT, maxViews: 1, expiresIn: '1h' }),
    });
    assert.equal(res.status, 401);
  });

  it('rejects invalid maxViews (0 or >20)', async () => {
    const res = await fetch(`${baseUrl}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(tokenA) },
      body: JSON.stringify({ iv: HEX24, ct: HEX_CT, maxViews: 0, expiresIn: '1h' }),
    });
    assert.equal(res.status, 400);
  });

  // ── List ────────────────────────────────────────────────────────────────────

  it('lists only own sends — no ciphertext returned (SND-03)', async () => {
    await Send.create({ ownerId: userA._id, iv: HEX24, ct: HEX_CT, maxViews: 1, expiresAt: new Date(Date.now() + 3600_000) });

    const res = await fetch(`${baseUrl}/api/v1/send`, { headers: authHeader(tokenA) });
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.ok(Array.isArray(body.sends), 'sends should be an array');
    // iv/ct must not appear in list
    for (const s of body.sends) {
      assert.ok(!s.ct, 'ct must not appear in list response');
      assert.ok(!s.iv, 'iv must not appear in list response');
    }
  });

  // ── Access (public consumer) ─────────────────────────────────────────────────

  it('access returns iv+ct on first view (SND-02)', async () => {
    const send = await Send.create({
      ownerId: userA._id,
      iv: HEX24,
      ct: HEX_CT,
      maxViews: 2,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const res = await fetch(`${baseUrl}/api/v1/send/${send._id}/access`, { method: 'POST' });
    assert.equal(res.status, 200);
    const body = await json(res);
    assert.equal(body.iv, HEX24);
    assert.equal(body.ct, HEX_CT);
  });

  it('access returns 410 when view limit exhausted (SND-02, AT-26)', async () => {
    const send = await Send.create({
      ownerId: userA._id,
      iv: HEX24,
      ct: HEX_CT,
      maxViews: 1,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const first = await fetch(`${baseUrl}/api/v1/send/${send._id}/access`, { method: 'POST' });
    assert.equal(first.status, 200);

    const second = await fetch(`${baseUrl}/api/v1/send/${send._id}/access`, { method: 'POST' });
    assert.equal(second.status, 410);
  });

  it('parallel access: exactly one succeeds when maxViews=1 (AT-26)', async () => {
    const send = await Send.create({
      ownerId: userA._id,
      iv: HEX24,
      ct: HEX_CT,
      maxViews: 1,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    // Fire two simultaneous access requests
    const [r1, r2] = await Promise.all([
      fetch(`${baseUrl}/api/v1/send/${send._id}/access`, { method: 'POST' }),
      fetch(`${baseUrl}/api/v1/send/${send._id}/access`, { method: 'POST' }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    // Exactly one 200 and one 410
    assert.deepEqual(statuses, [200, 410]);
  });

  it('access returns 410 for expired sends', async () => {
    const send = await Send.create({
      ownerId: userA._id,
      iv: HEX24,
      ct: HEX_CT,
      maxViews: 5,
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const res = await fetch(`${baseUrl}/api/v1/send/${send._id}/access`, { method: 'POST' });
    assert.equal(res.status, 410);
  });

  // ── Revoke ──────────────────────────────────────────────────────────────────

  it('owner can revoke own send (SND-03)', async () => {
    const send = await Send.create({
      ownerId: userA._id,
      iv: HEX24,
      ct: HEX_CT,
      maxViews: 5,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const res = await fetch(`${baseUrl}/api/v1/send/${send._id}`, {
      method: 'DELETE',
      headers: authHeader(tokenA),
    });
    assert.equal(res.status, 200);

    // Verify it's gone
    const revoked = await Send.findById(send._id);
    assert.equal(revoked, null);
  });

  it('user B cannot revoke user A send (IDOR)', async () => {
    const send = await Send.create({
      ownerId: userA._id,
      iv: HEX24,
      ct: HEX_CT,
      maxViews: 5,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const res = await fetch(`${baseUrl}/api/v1/send/${send._id}`, {
      method: 'DELETE',
      headers: authHeader(tokenB),
    });
    assert.equal(res.status, 404);

    // Ensure send still exists
    const still = await Send.findById(send._id);
    assert.ok(still, 'Send should still exist after failed delete');
  });
});
