import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  setupOwner,
  isSetupAvailable,
  isSetupTokenRequired,
  SetupError,
  SetupUnavailableError,
} from '@/server/auth/setup';
import { user } from '@/server/db/schema/auth';
import type { DbClient } from '@/server/db/client';

describe('AC-1 & AC-2: Owner bootstrap token verification, concurrency race, and permanent disabling', () => {
  let testDb: TestDatabaseInstance;
  const validSetupToken = 'c4d7e8f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9';
  const originalSetupToken = process.env.SETUP_TOKEN;
  const DUMMY_TEST_PASSWORD = 'ValidPassword123!';

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    process.env.SETUP_TOKEN = validSetupToken;
  });

  afterEach(async () => {
    process.env.SETUP_TOKEN = originalSetupToken;
    await testDb.destroy();
  });

  it('AC-1: rejects missing or incorrect setup token with generic error and creates no account', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Missing token
    await expect(
      setupOwner({
        setupToken: '',
        name: 'Owner',
        email: 'owner@example.com',
        password: 'ValidPassword123!',
        client: dbClient,
      }),
    ).rejects.toThrow(SetupError);

    // 2. Incorrect token
    await expect(
      setupOwner({
        setupToken: 'wrong_invalid_token_12345678901234567890123456789012',
        name: 'Owner',
        email: 'owner@example.com',
        password: 'ValidPassword123!',
        client: dbClient,
      }),
    ).rejects.toThrow('Invalid setup token or setup unavailable.');

    // 3. Invalid name
    await expect(
      setupOwner({
        setupToken: validSetupToken,
        name: '   ',
        email: 'owner@example.com',
        password: 'ValidPassword123!',
        client: dbClient,
      }),
    ).rejects.toThrow('Name must be between 1 and 255 characters.');

    // 4. Invalid email format
    await expect(
      setupOwner({
        setupToken: validSetupToken,
        name: 'Valid Name',
        email: 'invalid-email-address',
        password: 'ValidPassword123!',
        client: dbClient,
      }),
    ).rejects.toThrow('Invalid email address format.');

    // 5. Weak password
    await expect(
      setupOwner({
        setupToken: validSetupToken,
        name: 'Valid Name',
        email: 'owner@example.com',
        password: 'short',
        client: dbClient,
      }),
    ).rejects.toThrow('Password must be at least 12 characters long.');

    // Verify 0 users created in database
    const users = await dbClient.select().from(user);
    expect(users.length).toBe(0);
    expect(await isSetupAvailable(dbClient)).toBe(true);
  });

  it('AC-2: concurrent setup requests race: exactly one owner is created and subsequent requests fail with 404', async () => {
    const dbClient = testDb.db as unknown as DbClient;

    // Start 2 concurrent setup requests racing simultaneously
    const req1 = setupOwner({
      setupToken: validSetupToken,
      name: 'Owner Alpha',
      email: 'alpha@example.com',
      password: 'StrongPassword123!',
      client: dbClient,
    });

    const req2 = setupOwner({
      setupToken: validSetupToken,
      name: 'Owner Beta',
      email: 'beta@example.com',
      password: 'StrongPassword123!',
      client: dbClient,
    });

    const results = await Promise.allSettled([req1, req2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly ONE must succeed and exactly ONE must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // The rejected request must be SetupUnavailableError (404 status code)
    const firstRejected = rejected[0];
    if (!firstRejected) {
      throw new Error('Expected rejected result');
    }
    const rejectionReason: unknown = firstRejected.reason;
    expect(rejectionReason).toBeInstanceOf(SetupUnavailableError);
    if (rejectionReason instanceof SetupUnavailableError) {
      expect(rejectionReason.statusCode).toBe(404);
      expect(rejectionReason.message).toContain('Setup is permanently disabled');
    }

    // Verify database has exactly 1 user
    const users = await dbClient.select().from(user);
    expect(users.length).toBe(1);
    expect(users[0]?.role).toBe('owner');

    // From this point onward, isSetupAvailable must return false
    expect(await isSetupAvailable(dbClient)).toBe(false);

    // Any subsequent call to setupOwner must fail with 404
    await expect(
      setupOwner({
        setupToken: validSetupToken,
        name: 'Owner Gamma',
        email: 'gamma@example.com',
        password: 'StrongPassword123!',
        client: dbClient,
      }),
    ).rejects.toThrow(SetupUnavailableError);
  });

  it('AC-3: tokenless first-run setup creates initial owner when SETUP_TOKEN is unset or empty', async () => {
    process.env.SETUP_TOKEN = '';
    const dbClient = testDb.db as unknown as DbClient;

    expect(isSetupTokenRequired()).toBe(false);

    // Initial setup succeeds without providing setupToken
    const newOwner = await setupOwner({
      name: 'Tokenless Owner',
      email: 'tokenless@example.com',
      password: DUMMY_TEST_PASSWORD,
      client: dbClient,
    });

    expect(newOwner).toBeDefined();
    expect(newOwner.email).toBe('tokenless@example.com');
    expect(newOwner.role).toBe('owner');

    const users = await dbClient.select().from(user);
    expect(users.length).toBe(1);
    expect(await isSetupAvailable(dbClient)).toBe(false);
  });

  it('AC-6: negative — permanent setup lock is strictly enforced even when SETUP_TOKEN is unset/empty', async () => {
    process.env.SETUP_TOKEN = '';
    const dbClient = testDb.db as unknown as DbClient;

    // 1. Initial owner setup
    await setupOwner({
      name: 'Initial Owner',
      email: 'initial@example.com',
      password: DUMMY_TEST_PASSWORD,
      client: dbClient,
    });

    // 2. Second attempt must fail with SetupUnavailableError (404)
    await expect(
      setupOwner({
        name: 'Second Owner',
        email: 'second@example.com',
        password: DUMMY_TEST_PASSWORD,
        client: dbClient,
      }),
    ).rejects.toThrow(SetupUnavailableError);

    const users = await dbClient.select().from(user);
    expect(users.length).toBe(1);
  });
});
