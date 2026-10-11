import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { serverSchema } from '@/env';

describe('CLIENT_RETENTION_MONTHS Environment Validation (AC-11)', () => {
  const validServerEnvInput = {
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

  it('AC-11: defaults to 36 months when CLIENT_RETENTION_MONTHS is unset', () => {
    const env = { ...validServerEnvInput };
    delete (env as Record<string, unknown>).CLIENT_RETENTION_MONTHS;
    const parsed = serverSchema.safeParse(env);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.CLIENT_RETENTION_MONTHS).toBe(36);
    }
  });

  it('AC-11: parses configured retention period when set to 24', () => {
    const env = {
      ...validServerEnvInput,
      CLIENT_RETENTION_MONTHS: '24',
    };
    const parsed = serverSchema.safeParse(env);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.CLIENT_RETENTION_MONTHS).toBe(24);
    }
  });

  it('AC-11: fails validation when CLIENT_RETENTION_MONTHS is 0, naming the variable without echoing the value', () => {
    const badValue = '0';
    const env = {
      ...validServerEnvInput,
      CLIENT_RETENTION_MONTHS: badValue,
    };
    const parsed = serverSchema.safeParse(env);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.includes('CLIENT_RETENTION_MONTHS'));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('CLIENT_RETENTION_MONTHS');
      // Must not echo the secret/sensitive or raw value in an unsafe way
      expect(issue?.message).not.toContain(`"${badValue}"`);
    }
  });

  it('AC-11: fails validation when CLIENT_RETENTION_MONTHS is "abc", naming the variable without echoing the value', () => {
    const badValue = 'abc';
    const env = {
      ...validServerEnvInput,
      CLIENT_RETENTION_MONTHS: badValue,
    };
    const parsed = serverSchema.safeParse(env);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path.includes('CLIENT_RETENTION_MONTHS'));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('CLIENT_RETENTION_MONTHS');
      expect(issue?.message).not.toContain(`"${badValue}"`);
    }
  });
});
