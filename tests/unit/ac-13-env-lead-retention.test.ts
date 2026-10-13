import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateServerEnv, EnvValidationError, resetEnvCache, env } from '@/env';
import { getLeadRetentionMonths, getClientRetentionMonths } from '@/server/retention/policy';

describe('AC-13: LEAD_RETENTION_MONTHS environment validation', () => {
  const originalEnv = { ...process.env };

  const validBaseEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    AUTH_URL: 'http://localhost:3000',
    AUTH_SECRET: '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a',
    DATABASE_URL: 'postgres://ownlight_app:password@127.0.0.1:5432/ownlight_dev',
    STORAGE_ACCESS_KEY: 'valid_access_key_123',
    STORAGE_SECRET_KEY: '8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b',
  };

  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it('AC-13: defaults LEAD_RETENTION_MONTHS to 12 when omitted or empty', () => {
    const validatedOmitted = validateServerEnv(validBaseEnv);
    expect(validatedOmitted.LEAD_RETENTION_MONTHS).toBe(12);

    const validatedEmpty = validateServerEnv({
      ...validBaseEnv,
      LEAD_RETENTION_MONTHS: '',
    });
    expect(validatedEmpty.LEAD_RETENTION_MONTHS).toBe(12);
  });

  it('AC-13: accepts valid integer values between 1 and 36', () => {
    for (const months of [1, 6, 12, 24, 36]) {
      const validated = validateServerEnv({
        ...validBaseEnv,
        LEAD_RETENTION_MONTHS: String(months),
      });
      expect(validated.LEAD_RETENTION_MONTHS).toBe(months);
    }
  });

  it('AC-13: fails env validation when LEAD_RETENTION_MONTHS=0, naming the variable and the range 1–36', () => {
    expect(() => {
      validateServerEnv({
        ...validBaseEnv,
        LEAD_RETENTION_MONTHS: '0',
      });
    }).toThrow(EnvValidationError);

    try {
      validateServerEnv({
        ...validBaseEnv,
        LEAD_RETENTION_MONTHS: '0',
      });
      expect.unreachable('Should have thrown EnvValidationError for 0');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const valErr = err as EnvValidationError;
      expect(valErr.message).toContain('LEAD_RETENTION_MONTHS');
      expect(valErr.message).toMatch(/1[-–]36/);
    }
  });

  it('AC-13: fails env validation when LEAD_RETENTION_MONTHS=37, naming the variable and the range 1–36', () => {
    expect(() => {
      validateServerEnv({
        ...validBaseEnv,
        LEAD_RETENTION_MONTHS: '37',
      });
    }).toThrow(EnvValidationError);

    try {
      validateServerEnv({
        ...validBaseEnv,
        LEAD_RETENTION_MONTHS: '37',
      });
      expect.unreachable('Should have thrown EnvValidationError for 37');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const valErr = err as EnvValidationError;
      expect(valErr.message).toContain('LEAD_RETENTION_MONTHS');
      expect(valErr.message).toMatch(/1[-–]36/);
    }
  });

  it('AC-13: fails env validation when LEAD_RETENTION_MONTHS is not an integer', () => {
    const invalidValues = ['abc', '12.5', 'true', 'null'];

    for (const val of invalidValues) {
      try {
        validateServerEnv({
          ...validBaseEnv,
          LEAD_RETENTION_MONTHS: val,
        });
        expect.unreachable(`Should have thrown EnvValidationError for ${val}`);
      } catch (err) {
        expect(err).toBeInstanceOf(EnvValidationError);
        const valErr = err as EnvValidationError;
        expect(valErr.message).toContain('LEAD_RETENTION_MONTHS');
      }
    }
  });

  it('covers env proxy and retention helpers when SKIP_ENV_VALIDATION is true', () => {
    const origSkip = process.env.SKIP_ENV_VALIDATION;
    const origLead = process.env.LEAD_RETENTION_MONTHS;
    const origProxy = process.env.TRUSTED_PROXY_COUNT;
    const origPort = process.env.PORT;
    const origUrl = process.env.DATABASE_URL;

    try {
      process.env.SKIP_ENV_VALIDATION = 'true';

      // 1. LEAD_RETENTION_MONTHS in range (1-36)
      process.env.LEAD_RETENTION_MONTHS = '18';
      expect(env.LEAD_RETENTION_MONTHS).toBe(18);
      expect(getLeadRetentionMonths()).toBe(18);

      // 2. LEAD_RETENTION_MONTHS out of range (< 1)
      process.env.LEAD_RETENTION_MONTHS = '0';
      expect(env.LEAD_RETENTION_MONTHS).toBe(12);
      expect(getLeadRetentionMonths()).toBe(12);

      // 3. LEAD_RETENTION_MONTHS out of range (> 36)
      process.env.LEAD_RETENTION_MONTHS = '99';
      expect(env.LEAD_RETENTION_MONTHS).toBe(12);
      expect(getLeadRetentionMonths()).toBe(12);

      // 4. LEAD_RETENTION_MONTHS non-numeric string
      process.env.LEAD_RETENTION_MONTHS = 'not-a-number';
      expect(env.LEAD_RETENTION_MONTHS).toBe(12);
      expect(getLeadRetentionMonths()).toBe(12);

      // 5. LEAD_RETENTION_MONTHS omitted
      delete process.env.LEAD_RETENTION_MONTHS;
      expect(env.LEAD_RETENTION_MONTHS).toBe(12);
      expect(getLeadRetentionMonths()).toBe(12);

      // 6. TRUSTED_PROXY_COUNT: >= 0 is valid, negative falls back
      process.env.TRUSTED_PROXY_COUNT = '0';
      expect(env.TRUSTED_PROXY_COUNT).toBe(0);
      process.env.TRUSTED_PROXY_COUNT = '3';
      expect(env.TRUSTED_PROXY_COUNT).toBe(3);
      process.env.TRUSTED_PROXY_COUNT = '-2';
      expect(env.TRUSTED_PROXY_COUNT).toBe(1);

      // 7. General numeric defaults (e.g. PORT)
      process.env.PORT = '8080';
      expect(env.PORT).toBe(8080);
      process.env.PORT = '0';
      expect(env.PORT).toBe(3000);

      // 8. Non-numeric property access under SKIP_ENV_VALIDATION
      process.env.DATABASE_URL = 'postgres://custom-db:5432/db';
      expect(env.DATABASE_URL).toBe('postgres://custom-db:5432/db');
      delete process.env.DATABASE_URL;
      expect(env.DATABASE_URL).toBe('');

      // 9. CLIENT_RETENTION_MONTHS check
      expect(getClientRetentionMonths()).toBeGreaterThanOrEqual(1);
    } finally {
      if (origSkip !== undefined) {
        process.env.SKIP_ENV_VALIDATION = origSkip;
      } else {
        delete process.env.SKIP_ENV_VALIDATION;
      }
      if (origLead !== undefined) {
        process.env.LEAD_RETENTION_MONTHS = origLead;
      } else {
        delete process.env.LEAD_RETENTION_MONTHS;
      }
      if (origProxy !== undefined) {
        process.env.TRUSTED_PROXY_COUNT = origProxy;
      } else {
        delete process.env.TRUSTED_PROXY_COUNT;
      }
      if (origPort !== undefined) {
        process.env.PORT = origPort;
      } else {
        delete process.env.PORT;
      }
      if (origUrl !== undefined) {
        process.env.DATABASE_URL = origUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    }
  });
});
