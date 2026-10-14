import { describe, it, expect } from 'vitest';
import {
  deriveMasterKey,
  deriveAuthKey,
  deriveWrapKey,
  generateVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  generateRecoveryKeyBytes,
  encodeRecoveryKey,
  decodeRecoveryKey,
  deriveRecoveryWrapKey,
  deriveRecoveryVerifier,
  encryptItem,
  decryptItem,
  generateKdfSalt,
  fromHex,
  toHex,
} from '../lib/crypto.js';

describe('client crypto: KDF and sub-keys', () => {
  it('derives authKey and wrapKey from master key', async () => {
    const salt = fromHex(generateKdfSalt());
    const masterKey = await deriveMasterKey('correct horse battery staple', salt);
    const authKey = await deriveAuthKey(masterKey);
    const wrapKey = await deriveWrapKey(masterKey);

    expect(typeof authKey).toBe('string');
    expect(authKey.length).toBe(64); // 256 bits = 64 hex chars
    expect(wrapKey).toBeDefined();
    expect(wrapKey.algorithm.name).toBe('AES-GCM');
  });

  it('produces deterministic authKey for identical password and salt', async () => {
    const salt = fromHex('0123456789abcdef0123456789abcdef');
    const mk1 = await deriveMasterKey('password123', salt);
    const authKey1 = await deriveAuthKey(mk1);

    const mk2 = await deriveMasterKey('password123', salt);
    const authKey2 = await deriveAuthKey(mk2);

    expect(authKey1).toBe(authKey2);
  });
});

describe('client crypto: VaultKey wrapping', () => {
  it('wraps and unwraps vaultKey round-trip', async () => {
    const salt = fromHex(generateKdfSalt());
    const masterKey = await deriveMasterKey('password123', salt);
    const wrapKey = await deriveWrapKey(masterKey);

    const vaultKey = await generateVaultKey();
    const wrapped = await wrapVaultKey(vaultKey, wrapKey);

    expect(wrapped.iv.length).toBe(24); // 12 bytes = 24 hex chars
    expect(wrapped.ct.length).toBeGreaterThan(0);

    const unwrappedKey = await unwrapVaultKey(wrapped, wrapKey);
    expect(unwrappedKey).toBeDefined();
    expect(unwrappedKey.algorithm.name).toBe('AES-GCM');

    // Verify unwrapped key works by encrypting/decrypting
    const item = { name: 'Test Login', username: 'alice' };
    const enc = await encryptItem(item, unwrappedKey, 'user1', 'item1');
    const dec = await decryptItem(enc, unwrappedKey, 'user1', 'item1');
    expect(dec).toEqual(item);
  });

  it('fails unwrap with wrong wrapKey', async () => {
    const salt1 = fromHex(generateKdfSalt());
    const salt2 = fromHex(generateKdfSalt());
    const mk1 = await deriveMasterKey('passwordA', salt1);
    const mk2 = await deriveMasterKey('passwordB', salt2);
    const wrapKey1 = await deriveWrapKey(mk1);
    const wrapKey2 = await deriveWrapKey(mk2);

    const vaultKey = await generateVaultKey();
    const wrapped = await wrapVaultKey(vaultKey, wrapKey1);

    await expect(unwrapVaultKey(wrapped, wrapKey2)).rejects.toThrow();
  });
});

describe('client crypto: Item encryption and AAD binding', () => {
  it('encrypts and decrypts with matching AAD (userId:itemId)', async () => {
    const vaultKey = await generateVaultKey();
    const item = {
      name: 'GitHub',
      username: 'alice',
      password: 'supersecretpassword',
      notes: 'personal dev account',
    };

    const enc = await encryptItem(item, vaultKey, 'user_123', 'item_456');
    const dec = await decryptItem(enc, vaultKey, 'user_123', 'item_456');

    expect(dec).toEqual(item);
  });

  it('rejects decryption if AAD itemId does not match', async () => {
    const vaultKey = await generateVaultKey();
    const item = { name: 'Test' };
    const enc = await encryptItem(item, vaultKey, 'user_123', 'item_456');

    await expect(decryptItem(enc, vaultKey, 'user_123', 'item_different')).rejects.toThrow();
  });

  it('rejects decryption if AAD userId does not match', async () => {
    const vaultKey = await generateVaultKey();
    const item = { name: 'Test' };
    const enc = await encryptItem(item, vaultKey, 'user_123', 'item_456');

    await expect(decryptItem(enc, vaultKey, 'user_other', 'item_456')).rejects.toThrow();
  });

  it('rejects decryption if ciphertext is tampered', async () => {
    const vaultKey = await generateVaultKey();
    const item = { name: 'Test' };
    const enc = await encryptItem(item, vaultKey, 'user_123', 'item_456');

    // Flip bits in the ciphertext
    const ctBytes = fromHex(enc.ct);
    ctBytes[0] ^= 0xff;
    const tampered = { ...enc, ct: toHex(ctBytes) };

    await expect(decryptItem(tampered, vaultKey, 'user_123', 'item_456')).rejects.toThrow();
  });
});

describe('client crypto: Recovery key encode/decode and derivation', () => {
  it('encodes and decodes recovery key bytes identically', () => {
    const raw = generateRecoveryKeyBytes();
    expect(raw.length).toBe(20); // 160 bits

    const encoded = encodeRecoveryKey(raw);
    // 5 groups of 8 characters separated by spaces
    expect(encoded).toMatch(/^[A-Z2-7]{8}(\s[A-Z2-7]{8}){3}$/);

    const decoded = decodeRecoveryKey(encoded);
    expect(decoded).toEqual(raw);
  });

  it('derives recovery wrap key and verifier', async () => {
    const raw = generateRecoveryKeyBytes();
    const recoveryWrapKey = await deriveRecoveryWrapKey(raw);
    const verifier = await deriveRecoveryVerifier(raw);

    expect(recoveryWrapKey).toBeDefined();
    expect(recoveryWrapKey.algorithm.name).toBe('AES-GCM');
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBe(64);
  });
});
