import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('server-only', () => ({}));

import { configurePostgresDateSerializers } from '@/server/db/client';
import { shouldUseSecureCookies } from '@/server/auth/session';
import { isSetupTokenRequired, safeCompareTokens, isSetupAvailable } from '@/server/auth/setup';
import { setupOwnerInputSchema } from '@/server/auth/schema';

describe('TASK-0055: Synology LAN session cookies, Date serialization, setup token, and compose parity', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const composePath = path.resolve(rootDir, 'compose.synology.yml');
  const initRolesPath = path.resolve(rootDir, 'infra/postgres/init-roles.sh');
  const envExamplePath = path.resolve(rootDir, '.env.synology.example');
  const originalSetupToken = process.env.SETUP_TOKEN;

  afterEach(() => {
    if (originalSetupToken !== undefined) {
      process.env.SETUP_TOKEN = originalSetupToken;
    } else {
      delete process.env.SETUP_TOKEN;
    }
  });

  describe('AC-1: postgres-js Date parameter serialization', () => {
    it('AC-1: configurePostgresDateSerializers sets serializers for OIDs 1184, 1082, 1083, and 1114 converting Date instances to ISO strings', () => {
      const mockClient: { options?: { serializers?: Record<string, (val: unknown) => unknown> } } =
        {};
      configurePostgresDateSerializers(mockClient);

      expect(mockClient.options).toBeDefined();
      expect(mockClient.options?.serializers).toBeDefined();

      const serializers = mockClient.options?.serializers;
      expect(serializers).toBeDefined();
      if (!serializers) {
        throw new Error('serializers must be defined');
      }

      const testDate = new Date('2026-10-26T18:00:00.000Z');
      const isoString = testDate.toISOString();

      const s1184 = serializers['1184'];
      const s1082 = serializers['1082'];
      const s1083 = serializers['1083'];
      const s1114 = serializers['1114'];

      expect(s1184).toBeDefined();
      expect(s1082).toBeDefined();
      expect(s1083).toBeDefined();
      expect(s1114).toBeDefined();

      if (s1184 && s1082 && s1083 && s1114) {
        const serializerList = [s1184, s1082, s1083, s1114];
        for (const serializer of serializerList) {
          expect(serializer(testDate)).toBe(isoString);
          expect(serializer('already-a-string')).toBe('already-a-string');
          expect(serializer(null)).toBeNull();
          expect(serializer(12345)).toBe(12345);
        }
      }
    });
  });

  describe('AC-2: HTTP LAN vs HTTPS production session cookies', () => {
    it('AC-2: shouldUseSecureCookies returns true only in production with non-HTTP authUrl', () => {
      // 1. Production with HTTPS authUrl -> true (Secure cookie)
      expect(shouldUseSecureCookies('production', 'https://studio.example.com')).toBe(true);
      expect(shouldUseSecureCookies('production', 'https://my-nas.synology.me:3030')).toBe(true);
      expect(shouldUseSecureCookies('production', undefined)).toBe(true);
      expect(shouldUseSecureCookies('production', '')).toBe(true);

      // 2. Production with plain HTTP authUrl (Synology private LAN) -> false (Plain cookie)
      expect(shouldUseSecureCookies('production', 'http://192.168.178.33:3030')).toBe(false);
      expect(shouldUseSecureCookies('production', 'http://nas.local:3030')).toBe(false);
      expect(shouldUseSecureCookies('production', 'HTTP://10.0.0.5:3000')).toBe(false);

      // 3. Non-production environments -> false
      expect(shouldUseSecureCookies('development', 'https://studio.example.com')).toBe(false);
      expect(shouldUseSecureCookies('development', 'http://localhost:3000')).toBe(false);
      expect(shouldUseSecureCookies('test', 'http://localhost:3000')).toBe(false);
      expect(shouldUseSecureCookies(undefined, undefined)).toBe(false);
    });
  });

  describe('AC-3: Setup token presence requirement', () => {
    it('AC-3: isSetupTokenRequired returns true when SETUP_TOKEN is a non-empty string and false otherwise', () => {
      process.env.SETUP_TOKEN = 'strong_random_token_12345678901234567890';
      expect(isSetupTokenRequired()).toBe(true);

      process.env.SETUP_TOKEN = '';
      expect(isSetupTokenRequired()).toBe(false);

      process.env.SETUP_TOKEN = '   ';
      expect(isSetupTokenRequired()).toBe(false);

      delete process.env.SETUP_TOKEN;
      expect(isSetupTokenRequired()).toBe(false);
    });

    it('AC-3: safeCompareTokens handles non-string arguments and length mismatches safely', () => {
      expect(safeCompareTokens(null, 'secret')).toBe(false);
      expect(safeCompareTokens('secret', null)).toBe(false);
      expect(safeCompareTokens(123, 'secret')).toBe(false);
      expect(safeCompareTokens('secret', 123)).toBe(false);
      expect(safeCompareTokens('short', 'much_longer_token')).toBe(false);
      expect(safeCompareTokens('matching-token', 'matching-token')).toBe(true);
    });

    it('AC-3: isSetupAvailable falls back to true on database query error', async () => {
      const mockFaultyClient = {
        select: () => {
          throw new Error('Database connection failed');
        },
      } as unknown as Parameters<typeof isSetupAvailable>[0];

      expect(await isSetupAvailable(mockFaultyClient)).toBe(true);
    });

    it('AC-3: setupOwnerInputSchema validates and defaults optional setupToken to empty string', () => {
      const dummyPassword = 'TestPassword123!';
      const valid = setupOwnerInputSchema.safeParse({
        name: 'Studio Owner',
        email: 'owner@example.com',
        password: dummyPassword,
      });
      expect(valid.success).toBe(true);
      if (valid.success) {
        expect(valid.data.setupToken).toBe('');
      }

      const invalid = setupOwnerInputSchema.safeParse({
        name: 'A'.repeat(300),
        email: 'owner@example.com',
        password: 'pw',
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe('AC-5: Synology Compose, init-roles.sh, and .env.synology.example parity', () => {
    it('AC-5: init-roles.sh grants ALL ON SCHEMA public to migrator user', () => {
      const content = fs.readFileSync(initRolesPath, 'utf8');
      expect(content).toMatch(/GRANT ALL ON SCHEMA public TO/i);
    });

    it('AC-5: compose.synology.yml configures entrypoint permission wrapper on db service', () => {
      const content = fs.readFileSync(composePath, 'utf8');
      expect(content).toMatch(/init-roles\.sh.*:ro/);
      expect(content).toMatch(
        /entrypoint:\s*\[.*cp \/init-roles-source\.sh \/tmp\/init-roles\.sh.*chmod 0755 \/tmp\/init-roles\.sh.*ln -sf \/tmp\/init-roles\.sh \/docker-entrypoint-initdb\.d\/01-init-roles\.sh.*exec docker-entrypoint\.sh postgres.*\]/s,
      );
    });

    it('AC-5: compose.synology.yml configures SMTP_HOST fallback and SETUP_TOKEN on web and worker', () => {
      const content = fs.readFileSync(composePath, 'utf8');
      expect(content).toMatch(/SMTP_HOST:\s*['"]\$\{SMTP_HOST:-127\.0\.0\.1\}['"]/);
      expect(content).toMatch(/SETUP_TOKEN:\s*['"]\$\{SETUP_TOKEN:-\}['"]/);
    });

    it('AC-5: compose.synology.yml configures required environment variables and healthcheck on worker', () => {
      const content = fs.readFileSync(composePath, 'utf8');
      const workerSection =
        content.split(/worker:\s*\n/)[1]?.split(/\n\s{2}[a-z0-9_-]+:\s*\n/)[0] ?? '';

      expect(workerSection).toMatch(/AUTH_URL:\s*['"]\$\{AUTH_URL:-http:\/\/localhost:3030\}['"]/);
      expect(workerSection).toMatch(
        /AUTH_SECRET:\s*['"]\$\{AUTH_SECRET:\?AUTH_SECRET is required\}['"]/,
      );
      expect(workerSection).toMatch(
        /STORAGE_ACCESS_KEY:\s*['"]\$\{STORAGE_ACCESS_KEY:\?STORAGE_ACCESS_KEY is required\}['"]/,
      );
      expect(workerSection).toMatch(
        /STORAGE_SECRET_KEY:\s*['"]\$\{STORAGE_SECRET_KEY:\?STORAGE_SECRET_KEY is required\}['"]/,
      );
      expect(workerSection).toMatch(
        /healthcheck:\s*\n\s*test:\s*\[['"]CMD-SHELL['"],\s*['"]pgrep -f "scripts\/worker\.mjs" >\/dev\/null \|\| exit 1['"]\]/,
      );
    });

    it('AC-5: .env.synology.example documents STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY placeholders', () => {
      const content = fs.readFileSync(envExamplePath, 'utf8');
      expect(content).toMatch(/STORAGE_ACCESS_KEY=replace_with_storage_access_key/);
      expect(content).toMatch(/STORAGE_SECRET_KEY=replace_with_storage_secret_key/);
    });
  });
});
