import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateServerEnv, EnvValidationError, resetEnvCache } from '@/env';

describe('AC-10: TRUSTED_PROXY_COUNT environment validation', () => {
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

  it('AC-10: defaults TRUSTED_PROXY_COUNT to 1 when omitted or empty', () => {
    const validatedOmitted = validateServerEnv(validBaseEnv);
    expect(validatedOmitted.TRUSTED_PROXY_COUNT).toBe(1);

    const validatedEmpty = validateServerEnv({
      ...validBaseEnv,
      TRUSTED_PROXY_COUNT: '',
    });
    expect(validatedEmpty.TRUSTED_PROXY_COUNT).toBe(1);
  });

  it('AC-10: accepts valid integer values between 0 and 5', () => {
    for (let count = 0; count <= 5; count++) {
      const validated = validateServerEnv({
        ...validBaseEnv,
        TRUSTED_PROXY_COUNT: String(count),
      });
      expect(validated.TRUSTED_PROXY_COUNT).toBe(count);
    }
  });

  it('AC-10: fails env validation when TRUSTED_PROXY_COUNT=9 with message naming variable and range 0-5', () => {
    expect(() => {
      validateServerEnv({
        ...validBaseEnv,
        TRUSTED_PROXY_COUNT: '9',
      });
    }).toThrow(EnvValidationError);

    try {
      validateServerEnv({
        ...validBaseEnv,
        TRUSTED_PROXY_COUNT: '9',
      });
      expect.unreachable('Should have thrown EnvValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const valErr = err as EnvValidationError;
      expect(valErr.message).toContain('TRUSTED_PROXY_COUNT');
      expect(valErr.message).toMatch(/0.*5/);
    }
  });

  it('AC-10: fails env validation when TRUSTED_PROXY_COUNT=-1 with message naming variable and range 0-5', () => {
    expect(() => {
      validateServerEnv({
        ...validBaseEnv,
        TRUSTED_PROXY_COUNT: '-1',
      });
    }).toThrow(EnvValidationError);

    try {
      validateServerEnv({
        ...validBaseEnv,
        TRUSTED_PROXY_COUNT: '-1',
      });
      expect.unreachable('Should have thrown EnvValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const valErr = err as EnvValidationError;
      expect(valErr.message).toContain('TRUSTED_PROXY_COUNT');
      expect(valErr.message).toMatch(/0.*5/);
    }
  });

  it('AC-10: fails env validation when TRUSTED_PROXY_COUNT is not an integer', () => {
    const invalidValues = ['abc', '1.5', 'true', 'null'];

    for (const val of invalidValues) {
      try {
        validateServerEnv({
          ...validBaseEnv,
          TRUSTED_PROXY_COUNT: val,
        });
        expect.unreachable(`Should have thrown EnvValidationError for ${val}`);
      } catch (err) {
        expect(err).toBeInstanceOf(EnvValidationError);
        const valErr = err as EnvValidationError;
        expect(valErr.message).toContain('TRUSTED_PROXY_COUNT');
        expect(valErr.message).toMatch(/0.*5/);
      }
    }
  });
});
