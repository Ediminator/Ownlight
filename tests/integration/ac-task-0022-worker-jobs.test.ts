import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import type postgres from 'postgres';

vi.mock('server-only', () => ({}));

import { createIsolatedTestDatabase, type TestDatabaseInstance } from '../helpers/db-test-helper';
import {
  createFakePeopleServer,
  type FakePeopleServerInstance,
} from '../helpers/fake-people-server';
import { buildRetention } from '../../scripts/build-retention.mjs';
import { BackgroundWorker } from '@/server/retention/worker';
import { JobRegistry } from '@/server/worker/jobs';
import { clients, clientContacts } from '@/server/db/schema/clients';
import { googleContactsLinks } from '@/server/db/schema/google-contacts-links';
import { googleContactsOutbox } from '@/server/db/schema/google-contacts-outbox';
import { encryptSecret } from '@/server/crypto/vault';
import { GOOGLE_OAUTH_PURPOSE } from '@/server/integrations/google/constants';
import { upsertGoogleOAuthToken } from '@/server/integrations/google/repo';
import { enqueueContactUpsert } from '@/server/integrations/google/outbox';
import type { DbClient } from '@/server/db/client';

describe('TASK-0022: Worker Job Loop and Google Contacts Outbox Integration', () => {
  let testDb: TestDatabaseInstance;
  let fakePeople: FakePeopleServerInstance;

  const masterKey = '4f8c9b2d1e0a3f5c7b9a1d3e5f7a9b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a';
  const originalEnv = { ...process.env };
  const rootDir = path.resolve(import.meta.dirname, '../..');

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase();
    fakePeople = await createFakePeopleServer();

    process.env.ENCRYPTION_KEY = masterKey;
    process.env.GOOGLE_PEOPLE_API_BASE_URL = fakePeople.baseUrl;

    // Seed valid Google OAuth credentials
    const encryptedRefreshToken = await encryptSecret('test-refresh-token', GOOGLE_OAUTH_PURPOSE);
    await upsertGoogleOAuthToken(
      {
        encryptedRefreshToken,
        accessToken: 'test-access-token',
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        scope: 'https://www.googleapis.com/auth/contacts',
      },
      testDb.db as unknown as DbClient,
    );
  });

  afterEach(async () => {
    await fakePeople.close();
    await testDb.destroy();
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  function getDb(): DbClient {
    return testDb.db as unknown as DbClient;
  }

  it('AC-1: BackgroundWorker started with runOnce executes google-contacts-outbox, calling fake People API and creating link row', async () => {
    const dbClient = getDb();

    // 1. Create client with sync enabled and a contact
    const [client] = await dbClient
      .insert(clients)
      .values({
        displayName: 'John Doe Wedding',
        kind: 'person',
        preferredLocale: 'en',
        googleContactsSyncEnabled: true,
      })
      .returning();

    expect(client).toBeDefined();
    if (!client) throw new Error('Expected client to be defined');

    const [contact] = await dbClient
      .insert(clientContacts)
      .values({
        clientId: client.id,
        isPrimary: true,
        givenName: 'John',
        familyName: 'Doe',
        email: 'john@example.org',
        phone: '+49 30 987654',
      })
      .returning();

    expect(contact).toBeDefined();
    if (!contact) throw new Error('Expected contact to be defined');

    // 2. Enqueue PENDING UPSERT in outbox
    await enqueueContactUpsert(contact.id, dbClient);

    const pendingOutbox = await dbClient.select().from(googleContactsOutbox);
    expect(pendingOutbox).toHaveLength(1);
    expect(pendingOutbox[0]?.action).toBe('UPSERT');

    // 3. Start BackgroundWorker with runOnce: true. Must go through BackgroundWorker!
    const worker = new BackgroundWorker({
      db: dbClient,
      runOnce: true,
    });

    const result = await worker.start();
    expect(result.success).toBe(true);

    // 4. Verify fake People API received exactly one people:createContact call
    expect(fakePeople.requests).toHaveLength(1);
    const req = fakePeople.requests[0];
    expect(req).toBeDefined();
    if (!req) throw new Error('Expected fakePeople request');
    expect(req.url).toContain('/people:createContact');
    expect(req.method).toBe('POST');
    expect(req.parsedBody).toMatchObject({
      names: [{ givenName: 'John', familyName: 'Doe' }],
      phoneNumbers: [{ value: '+49 30 987654', type: 'mobile' }],
    });

    // 5. Verify link row created in google_contacts_links with returned resourceName
    const links = await dbClient
      .select()
      .from(googleContactsLinks)
      .where(eq(googleContactsLinks.contactId, contact.id));
    expect(links).toHaveLength(1);
    expect(links[0]?.googleResourceName).toMatch(/^people\/c\d+$/);

    // 6. Verify outbox row was deleted
    const outboxAfter = await dbClient.select().from(googleContactsOutbox);
    expect(outboxAfter).toHaveLength(0);
  });

  it('AC-2: built worker bundle dist/retention/worker.mjs exports job registry containing retention-sweep and google-contacts-outbox', async () => {
    const workerBundlePath = path.resolve(rootDir, 'dist/retention/worker.mjs');
    await buildRetention();
    expect(fs.existsSync(workerBundlePath)).toBe(true);

    const bundleUrl = pathToFileURL(workerBundlePath).href;
    // eslint-disable-next-line no-unsanitized/method -- Dynamic import of build artifact URL prevents TS2307 static resolution before build
    const distMod = (await import(bundleUrl)) as {
      jobRegistry: {
        get: (id: string) => { id: string; intervalMs: number } | undefined;
        getAll: () => { id: string; intervalMs: number }[];
      };
      BackgroundWorker: unknown;
      WORKER_ADVISORY_LOCK_ID: number;
    };

    expect(typeof distMod.BackgroundWorker).toBe('function');
    expect(distMod.WORKER_ADVISORY_LOCK_ID).toBe(884210);
    expect(distMod.jobRegistry).toBeDefined();

    const retentionJob = distMod.jobRegistry.get('retention-sweep');
    expect(retentionJob).toBeDefined();
    expect(retentionJob?.intervalMs).toBe(24 * 60 * 60 * 1000); // 24 hours

    const googleJob = distMod.jobRegistry.get('google-contacts-outbox');
    expect(googleJob).toBeDefined();
    expect(googleJob?.intervalMs).toBe(15_000); // 15 seconds
  }, 60000);

  it('AC-3: running worker with fake timers runs google-contacts-outbox every 15s while retention-sweep has not run a second time before 24h', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });

    const testRegistry = new JobRegistry();

    let sweepCount = 0;
    let outboxCount = 0;

    testRegistry.register({
      id: 'retention-sweep',
      intervalMs: 24 * 60 * 60 * 1000,
      run: () => {
        sweepCount += 1;
        return Promise.resolve({ totalDeleted: 0 });
      },
    });

    testRegistry.register({
      id: 'google-contacts-outbox',
      intervalMs: 15_000,
      run: () => {
        outboxCount += 1;
        return Promise.resolve({ syncedCount: 0 });
      },
    });

    const worker = new BackgroundWorker({
      registry: testRegistry,
      runOnce: false,
      mockAdvisoryLock: true,
    });

    try {
      // Start worker (runs initial cycle at t = 0)
      const startResult = await worker.start();
      expect(startResult.success).toBe(true);

      expect(sweepCount).toBe(1);
      expect(outboxCount).toBe(1);

      // Advance by 15 seconds: google-contacts-outbox runs once more, retention-sweep does NOT
      await vi.advanceTimersByTimeAsync(15_000);
      expect(outboxCount).toBe(2);
      expect(sweepCount).toBe(1);

      // Advance by another 15 seconds: google-contacts-outbox runs 3rd time, retention-sweep still 1
      await vi.advanceTimersByTimeAsync(15_000);
      expect(outboxCount).toBe(3);
      expect(sweepCount).toBe(1);

      // Advance up to 23 hours, 59 minutes: retention-sweep still has not run a 2nd time
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 - 30_000 - 1);
      expect(sweepCount).toBe(1);

      // Advance final millisecond to complete 24 hours: retention-sweep runs 2nd time
      await vi.advanceTimersByTimeAsync(1);
      expect(sweepCount).toBe(2);
    } finally {
      vi.useRealTimers();
      await worker.stop();
    }
  });

  it('AC-4: given google-contacts-outbox throws on its run, retention-sweep still runs and error is logged with job ID and error class only (zero PII/payload)', async () => {
    const dbClient = getDb();
    const testRegistry = new JobRegistry();

    let sweepExecuted = false;
    const sensitivePayloadMessage =
      'CRITICAL: Failed to sync contact Alice Smith +4930111222 email alice@example.org';

    testRegistry.register({
      id: 'google-contacts-outbox',
      intervalMs: 15_000,
      run: () => {
        throw new TypeError(sensitivePayloadMessage);
      },
    });

    testRegistry.register({
      id: 'retention-sweep',
      intervalMs: 24 * 60 * 60 * 1000,
      run: () => {
        sweepExecuted = true;
        return Promise.resolve({ totalDeleted: 0 });
      },
    });

    const loggedErrors: { metadata: unknown; message: string }[] = [];
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn().mockImplementation((metadata: unknown, message: string) => {
        loggedErrors.push({ metadata, message });
      }),
      debug: vi.fn(),
    } as unknown as typeof import('@/server/log').logger;

    const worker = new BackgroundWorker({
      db: dbClient,
      registry: testRegistry,
      logger: mockLogger,
      runOnce: true,
    });

    const outcome = await worker.start();
    expect(outcome.success).toBe(true);

    // 1. Retention sweep still executed despite google-contacts-outbox throwing
    expect(sweepExecuted).toBe(true);

    // 2. Error was logged with job ID and error class ONLY
    expect(loggedErrors).toHaveLength(1);
    const logged = loggedErrors[0];
    expect(logged).toBeDefined();
    if (!logged) throw new Error('Expected logged error');
    expect(logged.metadata).toEqual({
      jobId: 'google-contacts-outbox',
      errorClass: 'TypeError',
    });

    // 3. Absolute zero PII or message payload in logger call
    const serializedLog = JSON.stringify(logged);
    expect(serializedLog).not.toContain('Alice');
    expect(serializedLog).not.toContain('Smith');
    expect(serializedLog).not.toContain('+4930111222');
    expect(serializedLog).not.toContain('alice@example.org');
    expect(serializedLog).not.toContain(sensitivePayloadMessage);
  });

  it('AC-5: in-progress job does not start a second concurrent run when next interval fires', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });

    const testRegistry = new JobRegistry();

    let runCount = 0;
    let finishSlowRun: () => void = () => undefined;
    let isSlowRunActive = false;

    testRegistry.register({
      id: 'slow-job',
      intervalMs: 15_000,
      run: () => {
        runCount += 1;
        if (runCount === 2) {
          // The second run (first interval tick) simulates a slow/in-progress run
          isSlowRunActive = true;
          return new Promise<void>((resolve) => {
            finishSlowRun = () => {
              isSlowRunActive = false;
              resolve();
            };
          });
        }
        return Promise.resolve();
      },
    });

    const worker = new BackgroundWorker({
      registry: testRegistry,
      runOnce: false,
      mockAdvisoryLock: true,
    });

    try {
      // Start worker: initial run (run 1) completes during runCycle
      const startResult = await worker.start();
      expect(startResult.success).toBe(true);
      expect(runCount).toBe(1);

      // 1st interval fires at 15s: run 2 starts and remains in-flight
      await vi.advanceTimersByTimeAsync(15_000);
      expect(runCount).toBe(2);
      expect(isSlowRunActive).toBe(true);

      // 2nd interval fires at 30s while run 2 is still in-flight: concurrent run MUST NOT start
      await vi.advanceTimersByTimeAsync(15_000);
      expect(runCount).toBe(2); // Still 2: concurrency guard prevented overlapping execution

      // 3rd interval fires at 45s: still in-flight, still no overlapping run
      await vi.advanceTimersByTimeAsync(15_000);
      expect(runCount).toBe(2);

      // Direct invocation during active run also returns immediately without starting
      const slowJob = testRegistry.get('slow-job');
      expect(slowJob).toBeDefined();
      if (slowJob) {
        await worker.runJob(slowJob);
      }
      expect(runCount).toBe(2);

      // Complete in-flight run 2
      finishSlowRun();
      await vi.advanceTimersByTimeAsync(0);
      expect(isSlowRunActive).toBe(false);

      // 4th interval fires at 60s: now that previous run completed, run 3 starts
      await vi.advanceTimersByTimeAsync(15_000);
      expect(runCount).toBe(3);
    } finally {
      vi.useRealTimers();
      await worker.stop();
    }
  });

  it('AC-6: worker waits for in-flight job to finish on stop(), releases advisory lock, and starts no new runs', async () => {
    const dbClient = getDb();
    const testRegistry = new JobRegistry();

    let jobFinished = false;
    let finishJob: () => void = () => undefined;
    let runsStarted = 0;

    testRegistry.register({
      id: 'in-flight-job',
      intervalMs: 100,
      run: () => {
        runsStarted += 1;
        return new Promise<void>((resolve) => {
          finishJob = () => {
            jobFinished = true;
            resolve();
          };
        });
      },
    });

    let unlocked = false;
    const mockSql = Object.assign(
      vi.fn().mockImplementation((strings: TemplateStringsArray) => {
        const query = strings[0] ?? '';
        if (query.includes('pg_try_advisory_lock')) {
          return Promise.resolve([{ locked: true }]);
        }
        if (query.includes('pg_advisory_unlock')) {
          unlocked = true;
          return Promise.resolve([{ unlocked: true }]);
        }
        return Promise.resolve([]);
      }),
      {
        end: vi.fn().mockResolvedValue(undefined),
      },
    );

    const worker: BackgroundWorker = new BackgroundWorker({
      db: dbClient,
      sql: mockSql as unknown as postgres.Sql,
      registry: testRegistry,
      runOnce: false,
    });

    // Start worker in background
    const startPromise = worker.start();
    // Allow initial run to launch
    await new Promise((r) => setTimeout(r, 10));

    expect(runsStarted).toBe(1);
    expect(jobFinished).toBe(false);

    // Initiate stop while in-flight job is pending
    let stopResolved = false;
    const stopPromise = worker.stop().then(() => {
      stopResolved = true;
    });

    // stop() must not resolve before in-flight job completes
    await new Promise((r) => setTimeout(r, 20));
    expect(stopResolved).toBe(false);
    expect(jobFinished).toBe(false);

    // Complete in-flight job
    finishJob();
    await stopPromise;
    await startPromise;

    expect(stopResolved).toBe(true);
    expect(jobFinished).toBe(true);
    expect(unlocked).toBe(true);
    expect(worker.isShuttingDown).toBe(true);

    // Verify no new runs start after stop
    const inFlightJob = testRegistry.get('in-flight-job');
    expect(inFlightJob).toBeDefined();
    if (inFlightJob) {
      await worker.runJob(inFlightJob);
    }
    expect(runsStarted).toBe(1);
  });

  it('AC-7: duplicate worker exits cleanly without running jobs when advisory lock is already held', async () => {
    let jobExecuted = false;
    const testRegistry = new JobRegistry();
    testRegistry.register({
      id: 'any-job',
      intervalMs: 15_000,
      run: () => {
        jobExecuted = true;
        return Promise.resolve();
      },
    });

    const mockSql = Object.assign(
      vi.fn().mockImplementation((strings: TemplateStringsArray) => {
        const query = strings[0] ?? '';
        if (query.includes('pg_try_advisory_lock')) {
          // Another worker holds the advisory lock
          return Promise.resolve([{ locked: false }]);
        }
        return Promise.resolve([]);
      }),
      {
        end: vi.fn().mockResolvedValue(undefined),
      },
    );

    const worker: BackgroundWorker = new BackgroundWorker({
      connectionUrl: 'postgres://mock:mock@127.0.0.1:5432/mock_db',
      sql: mockSql as unknown as postgres.Sql,
      registry: testRegistry,
      runOnce: true,
    });

    const result = await worker.start();

    expect(result.success).toBe(false);
    expect(result.reason).toBe('locked');
    expect(jobExecuted).toBe(false);
    expect(mockSql.end).toHaveBeenCalled();
  });

  it('AC-10: ADR-0015 exists with status Proposed and operations documentation lists both jobs with their intervals', () => {
    // 1. ADR-0015 in docs/architecture/adr/
    const adrPath = path.resolve(
      rootDir,
      'docs/architecture/adr/0015-lead-capture-and-inquiry-forms.md',
    );
    expect(fs.existsSync(adrPath)).toBe(true);
    const adrContent = fs.readFileSync(adrPath, 'utf8');
    expect(adrContent).toContain('Status: Proposed');
    expect(adrContent).toContain('ADR-0015');

    // 2. Operations documentation in docs/operations/worker.md
    const opsPath = path.resolve(rootDir, 'docs/operations/worker.md');
    expect(fs.existsSync(opsPath)).toBe(true);
    const opsContent = fs.readFileSync(opsPath, 'utf8');
    expect(opsContent).toContain('retention-sweep');
    expect(opsContent).toContain('google-contacts-outbox');
    expect(opsContent).toContain('24 hours');
    expect(opsContent).toContain('15 seconds');
    expect(opsContent).toContain('WORKER_ADVISORY_LOCK_ID = 884210');
  });
});
