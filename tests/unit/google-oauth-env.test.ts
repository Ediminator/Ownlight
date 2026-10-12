import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  validateServerEnv,
  isGoogleOAuthConfigured,
  EnvValidationError,
  resetEnvCache,
} from '@/env';

describe('AC-1: Google OAuth and vault environment configuration', () => {
  const originalEnv = { ...process.env };

  const validBaseEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    AUTH_URL: 'http://localhost:3000',
    AUTH_SECRET: '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a',
    DATABASE_URL: 'postgres://ownlight_app:password@127.0.0.1:5432/ownlight_dev',
    MIGRATION_DATABASE_URL: 'postgres://ownlight_migrator:password@127.0.0.1:5432/ownlight_dev',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '1025',
    SMTP_FROM: 'noreply@example.com',
    STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
    STORAGE_PORT: '9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_ACCESS_KEY: 'valid_access_key_123',
    STORAGE_SECRET_KEY: '8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b',
    STORAGE_BUCKET_UPLOADS: 'ownlight-uploads',
    STORAGE_USE_SSL: 'false',
  };

  const validHexKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const validBase64Key = Buffer.from(validHexKey, 'hex').toString('base64');

  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('AC-1: marks Google integration as unconfigured when any required variable is missing', () => {
    expect(
      isGoogleOAuthConfigured({
        ENCRYPTION_KEY: undefined,
        GOOGLE_OAUTH_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
      }),
    ).toBe(false);

    expect(
      isGoogleOAuthConfigured({
        ENCRYPTION_KEY: validHexKey,
        GOOGLE_OAUTH_CLIENT_ID: undefined,
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
      }),
    ).toBe(false);

    expect(
      isGoogleOAuthConfigured({
        ENCRYPTION_KEY: validHexKey,
        GOOGLE_OAUTH_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: '',
      }),
    ).toBe(false);

    expect(
      isGoogleOAuthConfigured({
        ENCRYPTION_KEY: validHexKey,
        GOOGLE_OAUTH_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret',
      }),
    ).toBe(true);
  });

  it('AC-1: accepts valid 64-char hex ENCRYPTION_KEY and optional Google OAuth credentials', () => {
    const validated = validateServerEnv({
      ...validBaseEnv,
      ENCRYPTION_KEY: validHexKey,
      GOOGLE_OAUTH_CLIENT_ID: 'studio-google-client.apps.googleusercontent.com',
      GOOGLE_OAUTH_CLIENT_SECRET: 'GOCSPX-test-client-secret-12345',
    });

    expect(validated.ENCRYPTION_KEY).toBe(validHexKey);
    expect(validated.GOOGLE_OAUTH_CLIENT_ID).toBe(
      'studio-google-client.apps.googleusercontent.com',
    );
    expect(validated.GOOGLE_OAUTH_CLIENT_SECRET).toBe('GOCSPX-test-client-secret-12345');
  });

  it('AC-1: accepts valid 44-char base64 ENCRYPTION_KEY', () => {
    const validated = validateServerEnv({
      ...validBaseEnv,
      ENCRYPTION_KEY: validBase64Key,
    });

    expect(validated.ENCRYPTION_KEY).toBe(validBase64Key);
  });

  it('AC-1: rejects invalid ENCRYPTION_KEY with EnvValidationError', () => {
    // Insufficient length (32 chars hex = 16 bytes)
    expect(() =>
      validateServerEnv({
        ...validBaseEnv,
        ENCRYPTION_KEY: '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c',
      }),
    ).toThrow(EnvValidationError);

    // Placeholder substring
    expect(() =>
      validateServerEnv({
        ...validBaseEnv,
        ENCRYPTION_KEY: 'changeme_4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c',
      }),
    ).toThrow(EnvValidationError);
  });
});
