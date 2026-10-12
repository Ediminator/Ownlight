import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateServerEnv, EnvValidationError, resetEnvCache } from '@/env';

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
});
