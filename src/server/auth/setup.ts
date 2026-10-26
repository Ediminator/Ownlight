import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { user, account, type User } from '@/server/db/schema/auth';
import { env } from '@/env';
import { validatePasswordPolicy, hashPasswordArgon2id } from './passwords/policy';

export class SetupError extends Error {
  public readonly statusCode = 400;
  constructor(message = 'Invalid setup token or setup unavailable.') {
    super(message);
    this.name = 'SetupError';
  }
}

export class SetupUnavailableError extends Error {
  public readonly statusCode = 404;
  constructor(message = 'Setup is permanently disabled.') {
    super(message);
    this.name = 'SetupUnavailableError';
  }
}

/**
 * Constant-time string comparison using crypto.timingSafeEqual to prevent timing attacks.
 */
export function safeCompareTokens(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  const bufA = Buffer.from(provided, 'utf8');
  const bufB = Buffer.from(expected, 'utf8');

  if (bufA.length !== bufB.length) {
    // Equal work to prevent length-based early return timing leakage
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks whether setup is currently available (zero users in database).
 */
export async function isSetupAvailable(client: DbClient = defaultDb): Promise<boolean> {
  try {
    const result = await client.select({ count: sql<number>`count(*)::int` }).from(user);
    const total = result[0]?.count ?? 0;
    return total === 0;
  } catch {
    return true;
  }
}

/**
 * Checks whether setup token verification is required.
 * Returns true if SETUP_TOKEN is configured with a non-empty secret string.
 * Returns false when SETUP_TOKEN is unset or empty, enabling tokenless first-run setup.
 */
export function isSetupTokenRequired(): boolean {
  let expectedToken: string | undefined;
  try {
    expectedToken = env.SETUP_TOKEN;
  } catch {
    expectedToken = process.env.SETUP_TOKEN;
  }
  return typeof expectedToken === 'string' && expectedToken.trim().length > 0;
}

export interface SetupOwnerInput {
  setupToken?: string;
  name: string;
  email: string;
  password: string;
  client?: DbClient;
}

// Advisory lock key used to serialize concurrent owner bootstrap attempts
const SETUP_ADVISORY_LOCK_ID = 746869;

/**
 * Bootstraps the initial studio owner.
 * Protected by constant-time SETUP_TOKEN validation (when required) and transactional concurrency lock.
 */
export async function setupOwner({
  setupToken = '',
  name,
  email,
  password,
  client = defaultDb,
}: SetupOwnerInput): Promise<User> {
  // 1. Retrieve expected setup token and validate in constant time if token is required
  if (isSetupTokenRequired()) {
    let expectedToken: string | undefined;
    try {
      expectedToken = env.SETUP_TOKEN;
    } catch {
      expectedToken = process.env.SETUP_TOKEN;
    }

    if (!expectedToken || !safeCompareTokens(setupToken, expectedToken)) {
      throw new SetupError('Invalid setup token or setup unavailable.');
    }
  }

  // 3. Validate input fields
  const trimmedName = name.trim();
  if (trimmedName.length === 0 || trimmedName.length > 255) {
    throw new SetupError('Name must be between 1 and 255 characters.');
  }

  const normalizedEmail = email.toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    throw new SetupError('Invalid email address format.');
  }

  // 4. Validate password policy
  const policyResult = validatePasswordPolicy(password);
  if (!policyResult.valid) {
    throw new SetupError(policyResult.message ?? 'Password does not meet security requirements.');
  }

  // 5. Execute transactional setup with concurrency race protection
  return await client.transaction(async (tx) => {
    // Acquire PostgreSQL transaction-level advisory lock to serialize concurrent setup races
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SETUP_ADVISORY_LOCK_ID})`);

    // Verify zero users exist
    const countRes = await tx.select({ count: sql<number>`count(*)::int` }).from(user);
    const existingCount = countRes[0]?.count ?? 0;

    if (existingCount > 0) {
      throw new SetupUnavailableError('Setup is permanently disabled. Owner already exists.');
    }

    // Hash password with Argon2id
    const passwordHash = await hashPasswordArgon2id(password);

    // Create owner user
    const [newUser] = await tx
      .insert(user)
      .values({
        name: trimmedName,
        email: normalizedEmail,
        role: 'owner',
        emailVerified: true,
      })
      .returning();

    if (!newUser) {
      throw new Error('Failed to create owner user.');
    }

    // Create credential account
    await tx.insert(account).values({
      accountId: normalizedEmail,
      providerId: 'credential',
      userId: newUser.id,
      password: passwordHash,
    });

    return newUser;
  });
}
