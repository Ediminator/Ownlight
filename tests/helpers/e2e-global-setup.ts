import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { seedDemo } from '../../scripts/seed-demo.mjs';
import { seedAllE2eInquiryForms } from './e2e-inquiry-helper';

export const E2E_OWNER_EMAIL = 'owner@example.com';
export const E2E_OWNER_PASSWORD = 'ValidOwnerPassword123!';

export default async function globalSetup() {
  const dbDir = path.resolve('./.pglite-e2e');
  fs.rmSync(dbDir, { recursive: true, force: true });

  const pglite = new PGlite(dbDir);
  await pglite.waitReady;

  const drizzleDir = path.resolve('./drizzle');
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of sqlFiles) {
    const sql = fs.readFileSync(path.join(drizzleDir, file), 'utf8');
    await pglite.exec(sql);
  }

  // Seed demo data (clients, contacts, addresses, tags, studio settings)
  const dbClient = drizzle(pglite);
  await seedDemo({
    dbClient,
    seed: 42,
    forceDemo: true,
    nodeEnv: 'test',
  });

  // Seed inquiry forms for public inquiry E2E tests (TASK-0027)
  await seedAllE2eInquiryForms(pglite);

  await pglite.close();
}

export async function setE2eStudioMfaSettings(
  mfaRequired: boolean,
  postponedUntil: Date | null = null,
) {
  const pglite = new PGlite(path.resolve('./.pglite-e2e'));
  await pglite.waitReady;
  const check = await pglite.query('SELECT id FROM studio_settings LIMIT 1');
  const now = new Date().toISOString();
  if (check.rows.length === 0) {
    const id = '018f0000-0000-7000-8000-000000000001';
    await pglite.query(
      `INSERT INTO studio_settings (id, studio_name, default_locale, timezone, currency, mfa_required, mfa_postponed_until, created_at, updated_at)
       VALUES ($1, 'Photo Studio', 'en', 'UTC', 'EUR', $2, $3, $4, $4)`,
      [id, mfaRequired, postponedUntil ? postponedUntil.toISOString() : null, now],
    );
  } else {
    await pglite.query(
      'UPDATE studio_settings SET mfa_required = $1, mfa_postponed_until = $2, updated_at = $3',
      [mfaRequired, postponedUntil ? postponedUntil.toISOString() : null, now],
    );
  }
  await pglite.close();
}

export async function clearE2eUserMfaCredentials() {
  const pglite = new PGlite(path.resolve('./.pglite-e2e'));
  await pglite.waitReady;
  await pglite.query('DELETE FROM totp_credential');
  await pglite.query('DELETE FROM passkey_credential');
  await pglite.query('DELETE FROM recovery_code');
  await pglite.close();
}
