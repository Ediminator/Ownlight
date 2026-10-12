import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  encryptSecret,
  decryptSecret,
  parseMasterKey,
  deriveVaultSubkey,
  VaultConfigurationError,
  VaultDecryptionError,
  VaultError,
} from '@/server/crypto/vault';

describe('AC-2: Encrypted Credential Vault (HKDF-SHA256 & AES-256-GCM)', () => {
  const validHexKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const validBase64Key = Buffer.from(validHexKey, 'hex').toString('base64');
  const googlePurpose = 'ownlight:vault:google_oauth';
  const lexwarePurpose = 'ownlight:vault:lexware_api';

  const originalEncryptionKey = process.env.ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = validHexKey;
  });

  afterEach(() => {
    if (originalEncryptionKey !== undefined) {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
  });

  it('AC-2: successfully encrypts and decrypts secret roundtrip with hex key', async () => {
    const secret = 'refresh_token_test_12345_very_secret';
    const ciphertext = await encryptSecret(secret, googlePurpose);

    expect(ciphertext).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    const decrypted = await decryptSecret(ciphertext, googlePurpose);
    expect(decrypted).toBe(secret);
  });

  it('AC-2: successfully encrypts and decrypts secret roundtrip with base64 key', async () => {
    const secret = 'google_refresh_token_base64_master_key_test';
    const ciphertext = await encryptSecret(secret, googlePurpose, validBase64Key);

    expect(ciphertext.startsWith('v1:')).toBe(true);
    const decrypted = await decryptSecret(ciphertext, googlePurpose, validBase64Key);
    expect(decrypted).toBe(secret);
  });

  it('AC-2: enforces cross-purpose isolation; wrong purpose throws VaultDecryptionError and fails closed', async () => {
    const secret = 'super_confidential_oauth_refresh_token';
    const ciphertext = await encryptSecret(secret, googlePurpose);

    await expect(decryptSecret(ciphertext, lexwarePurpose)).rejects.toThrow(VaultDecryptionError);
  });

  it('AC-2: detects ciphertext tampering; payload modification throws VaultDecryptionError', async () => {
    const secret = 'tamper_test_secret_value';
    const ciphertext = await encryptSecret(secret, googlePurpose);

    const parts = ciphertext.split(':');
    expect(parts.length).toBe(4);
    const version = parts[0] ?? '';
    const iv = parts[1] ?? '';
    const tag = parts[2] ?? '';
    const ct = parts[3] ?? '';

    // Tamper with last character of ciphertext
    const tamperedCt = ct.slice(0, -1) + (ct.endsWith('a') ? 'b' : 'a');
    const tamperedCiphertext = `${version}:${iv}:${tag}:${tamperedCt}`;

    await expect(decryptSecret(tamperedCiphertext, googlePurpose)).rejects.toThrow(
      VaultDecryptionError,
    );
  });

  it('AC-2: detects authentication tag tampering; throws VaultDecryptionError', async () => {
    const secret = 'tag_tamper_test_secret_value';
    const ciphertext = await encryptSecret(secret, googlePurpose);

    const parts = ciphertext.split(':');
    expect(parts.length).toBe(4);
    const version = parts[0] ?? '';
    const iv = parts[1] ?? '';
    const tag = parts[2] ?? '';
    const ct = parts[3] ?? '';

    const tamperedTag = (tag.startsWith('A') ? 'B' : 'A') + tag.slice(1);
    const tamperedCiphertext = `${version}:${iv}:${tamperedTag}:${ct}`;

    await expect(decryptSecret(tamperedCiphertext, googlePurpose)).rejects.toThrow(
      VaultDecryptionError,
    );
  });

  it('AC-2: detects IV tampering; throws VaultDecryptionError', async () => {
    const secret = 'iv_tamper_test_secret_value';
    const ciphertext = await encryptSecret(secret, googlePurpose);

    const parts = ciphertext.split(':');
    expect(parts.length).toBe(4);
    const version = parts[0] ?? '';
    const iv = parts[1] ?? '';
    const tag = parts[2] ?? '';
    const ct = parts[3] ?? '';

    const tamperedIv = (iv.startsWith('x') ? 'y' : 'x') + iv.slice(1);
    const tamperedCiphertext = `${version}:${tamperedIv}:${tag}:${ct}`;

    await expect(decryptSecret(tamperedCiphertext, googlePurpose)).rejects.toThrow(
      VaultDecryptionError,
    );
  });

  it('AC-2: rejects invalid master key formats (wrong length, invalid chars, missing key)', () => {
    expect(() => parseMasterKey('')).toThrow(VaultConfigurationError);
    expect(() => parseMasterKey(undefined)).toThrow(VaultConfigurationError);
    // Too short hex
    expect(() => parseMasterKey('4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c')).toThrow(
      VaultConfigurationError,
    );
    // 65 chars (too long)
    expect(() => parseMasterKey(validHexKey + '0')).toThrow(VaultConfigurationError);
    // Invalid characters
    expect(() => parseMasterKey('Z'.repeat(64))).toThrow(VaultConfigurationError);

    const keyBuf = parseMasterKey(validHexKey);
    expect(keyBuf.byteLength).toBe(32);
  });

  it('AC-2: HKDF subkey derivation produces consistent 32-byte keys for same purpose and distinct keys for different purposes', () => {
    const masterBuf = parseMasterKey(validHexKey);
    const subkey1 = deriveVaultSubkey(masterBuf, googlePurpose);
    const subkey2 = deriveVaultSubkey(masterBuf, googlePurpose);
    const subkeyOther = deriveVaultSubkey(masterBuf, lexwarePurpose);

    expect(subkey1.byteLength).toBe(32);
    expect(subkey1.equals(subkey2)).toBe(true);
    expect(subkey1.equals(subkeyOther)).toBe(false);

    expect(() => deriveVaultSubkey(masterBuf, '')).toThrow(VaultError);
  });

  it('AC-2: rejects malformed payload strings, unsupported versions, or invalid lengths', async () => {
    await expect(decryptSecret('not_a_valid_vault_string', googlePurpose)).rejects.toThrow(
      VaultDecryptionError,
    );
    await expect(decryptSecret('v2:iv:tag:ct', googlePurpose)).rejects.toThrow(
      VaultDecryptionError,
    );
    await expect(decryptSecret('v1:short:tag:ct', googlePurpose)).rejects.toThrow(
      VaultDecryptionError,
    );
  });
});
