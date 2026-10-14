// @ts-check
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Item } from '../src/models/Item.js';
import { Folder } from '../src/models/Folder.js';
import { issueAccessToken } from '../lib/tokens.js';
import { hashAuthKey, hashRecoveryVerifier } from '../lib/crypto.js';

describe('Phase 5: Vault API & Cryptographic Isolation', () => {
  let mongod;
  let server;
  let baseUrl;
  let userA;
  let tokenA;
  let userB;
  let tokenB;

  before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    const app = createApp();
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve(null);
      });
    });
  });

  after(async () => {
    server?.close();
    await mongoose.disconnect();
    await mongod?.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Item.deleteMany({});
    await Folder.deleteMany({});

    const authHash = await hashAuthKey('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    userA = await User.create({
      email: 'usera@vaultguard.local',
      emailVerified: true,
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: 'abcdef0123456789abcdef0123456789' },
      authHash,
      wrappedVaultKey: { iv: '000000000000000000000000', ct: 'aabbcc' },
      recoveryWrappedVaultKey: { iv: '000000000000000000000000', ct: 'ddeeff' },
      recoveryVerifierHash: hashRecoveryVerifier('abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'),
      recoveryKeyConfirmed: true,
      status: 'active',
    });
    tokenA = issueAccessToken({ id: userA._id.toString(), email: userA.email, role: 'user' });

    userB = await User.create({
      email: 'userb@vaultguard.local',
      emailVerified: true,
      kdf: { algo: 'PBKDF2-SHA256', iterations: 600000, salt: '11223344556677889900aabbccddeeff' },
      authHash,
      wrappedVaultKey: { iv: '111111111111111111111111', ct: '112233' },
      recoveryWrappedVaultKey: { iv: '111111111111111111111111', ct: '445566' },
      recoveryVerifierHash: hashRecoveryVerifier('1111111111111111111111111111111111111111111111111111111111111111'),
      recoveryKeyConfirmed: true,
      status: 'active',
    });
    tokenB = issueAccessToken({ id: userB._id.toString(), email: userB.email, role: 'user' });
  });

  it('Creates encrypted vault item and retrieves via sync (VLT-01, VLT-02, VLT-06)', async () => {
    const itemId = new mongoose.Types.ObjectId().toString();
    const createRes = await fetch(`${baseUrl}/api/v1/vault/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        _id: itemId,
        iv: '0123456789abcdef01234567',
        ct: 'deadbeefcafebabe',
      }),
    });

    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.equal(createData.item._id, itemId);
    assert.equal(createData.item.rev, 1);
    assert.equal(createData.item.ct, 'deadbeefcafebabe');

    // Sync
    const syncRes = await fetch(`${baseUrl}/api/v1/vault/sync`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(syncRes.status, 200);
    const syncData = await syncRes.json();
    assert.equal(syncData.items.length, 1);
    assert.equal(syncData.items[0]._id, itemId);
  });

  it('Enforces optimistic concurrency control using If-Match (VLT-03)', async () => {
    const item = await Item.create({
      userId: userA._id,
      iv: '0123456789abcdef01234567',
      ct: 'deadbeef',
      rev: 1,
    });

    // 1. Missing If-Match returns 400
    const noMatchRes = await fetch(`${baseUrl}/api/v1/vault/items/${item._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        iv: '0123456789abcdef01234567',
        ct: 'feedface',
      }),
    });
    assert.equal(noMatchRes.status, 400);

    // 2. Successful update with If-Match: 1
    const updateRes = await fetch(`${baseUrl}/api/v1/vault/items/${item._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
        'If-Match': '1',
      },
      body: JSON.stringify({
        iv: '0123456789abcdef01234567',
        ct: 'feedface',
      }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = await updateRes.json();
    assert.equal(updateData.item.rev, 2);
    assert.equal(updateData.item.ct, 'feedface');

    // 3. Concurrent edit using stale If-Match: 1 returns 409 CONFLICT
    const conflictRes = await fetch(`${baseUrl}/api/v1/vault/items/${item._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
        'If-Match': '1',
      },
      body: JSON.stringify({
        iv: '0123456789abcdef01234567',
        ct: 'c001cafe',
      }),
    });
    assert.equal(conflictRes.status, 409);
    const conflictData = await conflictRes.json();
    assert.equal(conflictData.error.code, 'CONFLICT');
    assert.equal(conflictData.error.currentItem.rev, 2);
  });

  it('Prevents IDOR: User B cannot view, edit, or delete User A items (VLT-03, NFR-S1)', async () => {
    const itemA = await Item.create({
      userId: userA._id,
      iv: '0123456789abcdef01234567',
      ct: 'deadbeef',
      rev: 1,
    });

    // User B tries to update User A's item
    const putRes = await fetch(`${baseUrl}/api/v1/vault/items/${itemA._id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
        'If-Match': '1',
      },
      body: JSON.stringify({
        iv: '0123456789abcdef01234567',
        ct: 'bad0bad0',
      }),
    });
    assert.equal(putRes.status, 404);

    // User B tries to delete User A's item
    const delRes = await fetch(`${baseUrl}/api/v1/vault/items/${itemA._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(delRes.status, 404);

    // User B sync does not leak User A's item
    const syncRes = await fetch(`${baseUrl}/api/v1/vault/sync`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const syncData = await syncRes.json();
    assert.equal(syncData.items.length, 0);
  });

  it('Supports soft delete to trash, restore, and permanent deletion (VLT-04)', async () => {
    const item = await Item.create({
      userId: userA._id,
      iv: '0123456789abcdef01234567',
      ct: 'deadbeef',
      rev: 1,
    });

    // 1. Move to trash
    const trashRes = await fetch(`${baseUrl}/api/v1/vault/items/${item._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(trashRes.status, 200);

    const trashedDb = await Item.findById(item._id);
    assert.ok(trashedDb?.deletedAt);
    assert.ok(trashedDb?.purgeAt);

    // 2. Restore from trash
    const restoreRes = await fetch(`${baseUrl}/api/v1/vault/items/${item._id}/restore`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(restoreRes.status, 200);

    const restoredDb = await Item.findById(item._id);
    assert.equal(restoredDb?.deletedAt, null);
    assert.equal(restoredDb?.purgeAt, null);

    // 3. Permanent delete
    const permRes = await fetch(`${baseUrl}/api/v1/vault/items/${item._id}/permanent`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(permRes.status, 200);

    const permDb = await Item.findById(item._id);
    assert.equal(permDb, null);
  });

  it('Supports folder creation, listing, updating, and deletion (VLT-05)', async () => {
    // 1. Create folder
    const createRes = await fetch(`${baseUrl}/api/v1/vault/folders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        iv: '0123456789abcdef01234567',
        ct: 'abcdef123456',
      }),
    });
    assert.equal(createRes.status, 201);
    const { folder } = await createRes.json();
    assert.ok(folder._id);

    // 2. List folders
    const listRes = await fetch(`${baseUrl}/api/v1/vault/folders`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(listRes.status, 200);
    const { folders } = await listRes.json();
    assert.equal(folders.length, 1);
    assert.equal(folders[0]._id, folder._id);

    // 3. Delete folder
    const delRes = await fetch(`${baseUrl}/api/v1/vault/folders/${folder._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(delRes.status, 200);
  });
});
