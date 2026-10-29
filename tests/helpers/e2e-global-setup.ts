import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { seedDemo } from '../../scripts/seed-demo.mjs';
import { seedAllE2eInquiryForms } from './e2e-inquiry-helper';
import { seedAllE2eLeads } from './e2e-leads-helper';
import { seedAllE2eProjects } from './e2e-projects-helper';
import { seedAllE2eCalendar } from './e2e-calendar-helper';
import { seedAllE2eProposals } from './e2e-proposals-helper';

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

  // Seed sample leads for lead inbox and management UI E2E tests (TASK-0031)
  await seedAllE2eLeads(pglite);

  // Seed sample projects and tasks for kanban pipeline board UI E2E tests (TASK-0036)
  await seedAllE2eProjects(pglite);

  // Seed calendar defaults (booking types & availability schedules) for booking E2E tests (TASK-0044)
  await seedAllE2eCalendar(pglite);

  // Seed proposal packages, catalogue add-ons, and draft proposals (TASK-0061)
  await seedAllE2eProposals(pglite);

  await pglite.close();
}

export async function setE2eStudioMfaSettings(
  mfaRequired: boolean,
  postponedUntil: Date | null = null,
) {
  await new Promise((r) => setTimeout(r, 600));
  for (let attempt = 0; attempt < 8; attempt++) {
    let pglite: PGlite | null = null;
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
      pglite = new PGlite(path.resolve('./.pglite-e2e'));
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
      return;
    } catch (err) {
      if (attempt === 7) throw err;
    } finally {
      if (pglite) {
        try {
          await pglite.close();
        } catch {
          // ignore close error
        }
      }
    }
  }
}

export async function clearE2eUserMfaCredentials() {
  await new Promise((r) => setTimeout(r, 300));
  for (let attempt = 0; attempt < 8; attempt++) {
    let pglite: PGlite | null = null;
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
      pglite = new PGlite(path.resolve('./.pglite-e2e'));
      await pglite.waitReady;
      await pglite.query('DELETE FROM totp_credential');
      await pglite.query('DELETE FROM passkey_credential');
      await pglite.query('DELETE FROM recovery_code');
      return;
    } catch (err) {
      if (attempt === 7) throw err;
    } finally {
      if (pglite) {
        try {
          await pglite.close();
        } catch {
          // ignore close error
        }
      }
    }
  }
}
