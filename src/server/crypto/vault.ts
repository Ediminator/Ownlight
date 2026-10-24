import 'server-only';
import { hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { env } from '@/env';

/**
 * Vault domain errors.
 */
export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultError';
  }
}

export class VaultConfigurationError extends VaultError {
  constructor(message: string) {
    super(message);
    this.name = 'VaultConfigurationError';
  }
}

export class VaultDecryptionError extends VaultError {
  constructor(message: string) {
    super(message);
    this.name = 'VaultDecryptionError';
  }
}

/**
 * Parses and validates the 32-byte master key from ENCRYPTION_KEY (hex or base64).
 */
export function parseMasterKey(keyStr?: string | null): Buffer {
  if (!keyStr || typeof keyStr !== 'string' || keyStr.trim().length === 0) {
    throw new VaultConfigurationError('ENCRYPTION_KEY is required but not configured.');
  }

  const trimmed = keyStr.trim();

  // 64-character hex (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // 44-character base64 (32 bytes)
  if (/^[A-Za-z0-9+/]{43}=$/.test(trimmed) || /^[A-Za-z0-9+/]{44}$/.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed, 'base64');
      if (decoded.byteLength === 32) {
        return decoded;
      }
    } catch {
      // Fall through to error
    }
  }

  throw new VaultConfigurationError(
    'ENCRYPTION_KEY must be a 32-byte secret encoded as 64 hex characters or 44 base64 characters.',
  );
}

/**
 * Derives a purpose-specific 256-bit subkey via HKDF-SHA256 (RFC 5869).
 * Fixed domain salt: 'ownlight:vault:v1'.
 */
export function deriveVaultSubkey(masterKey: Buffer, purpose: string): Buffer {
  if (!purpose || typeof purpose !== 'string' || purpose.trim().length === 0) {
    throw new VaultError('Purpose string cannot be empty.');
  }

  return Buffer.from(hkdfSync('sha256', masterKey, 'ownlight:vault:v1', purpose, 32));
}

/**
 * Encrypts a sensitive string using AES-256-GCM with a fresh random 12-byte IV
 * and purpose-derived subkey.
 *
 * Output format: v1:{iv_b64url}:{tag_b64url}:{ciphertext_b64url}
 */
export function encryptSecret(
  plaintext: string,
  purpose: string,
  masterKeyOverride?: string,
): Promise<string> {
  if (typeof plaintext !== 'string') {
    return Promise.reject(new VaultError('Plaintext must be a string.'));
  }

  try {
    const masterKeyRaw =
      masterKeyOverride ??
      process.env.ENCRYPTION_KEY ??
      (process.env.USE_PGLITE === 'true' ? process.env.AUTH_SECRET : undefined) ??
      (process.env.NODE_ENV === 'test' ? undefined : env.ENCRYPTION_KEY);
    const masterKeyBuf = parseMasterKey(masterKeyRaw);
    const subkey = deriveVaultSubkey(masterKeyBuf, purpose);

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', subkey, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Promise.resolve(
      `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`,
    );
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new VaultError(String(err)));
  }
}

/**
 * Decrypts a vault ciphertext formatted as v1:{iv}:{tag}:{ciphertext}.
 * Authenticates tag and purpose; tampering or purpose mismatches fail closed.
 */
export function decryptSecret(
  serialized: string,
  purpose: string,
  masterKeyOverride?: string,
): Promise<string> {
  if (!serialized || typeof serialized !== 'string') {
    return Promise.reject(new VaultDecryptionError('Invalid ciphertext payload format.'));
  }

  const parts = serialized.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    return Promise.reject(
      new VaultDecryptionError('Unsupported vault ciphertext version or format.'),
    );
  }

  const [, ivB64url, tagB64url, ciphertextB64url] = parts;
  if (!ivB64url || !tagB64url || !ciphertextB64url) {
    return Promise.reject(new VaultDecryptionError('Malformed vault ciphertext components.'));
  }

  const iv = Buffer.from(ivB64url, 'base64url');
  const tag = Buffer.from(tagB64url, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64url, 'base64url');

  if (iv.byteLength !== 12) {
    return Promise.reject(new VaultDecryptionError('Invalid IV length: expected 12 bytes.'));
  }
  if (tag.byteLength !== 16) {
    return Promise.reject(
      new VaultDecryptionError('Invalid authentication tag length: expected 16 bytes.'),
    );
  }

  try {
    const masterKeyRaw =
      masterKeyOverride ??
      process.env.ENCRYPTION_KEY ??
      (process.env.USE_PGLITE === 'true' ? process.env.AUTH_SECRET : undefined) ??
      (process.env.NODE_ENV === 'test' ? undefined : env.ENCRYPTION_KEY);
    const masterKeyBuf = parseMasterKey(masterKeyRaw);
    const subkey = deriveVaultSubkey(masterKeyBuf, purpose);

    const decipher = createDecipheriv('aes-256-gcm', subkey, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return Promise.resolve(plaintext.toString('utf8'));
  } catch (err) {
    if (err instanceof VaultError) {
      return Promise.reject(err);
    }
    return Promise.reject(
      new VaultDecryptionError(
        'Decryption failed: authentication tag mismatch or payload has been tampered with.',
      ),
    );
  }
}
