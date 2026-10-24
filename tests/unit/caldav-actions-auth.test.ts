import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  mockRequireOwner,
  MockForbiddenError,
  mockGetCaldavAccount,
  mockSaveCaldavAccount,
  mockDeleteCaldavAccount,
  mockRunCalendarSyncWorker,
} = vi.hoisted(() => {
  class MockForbiddenError extends Error {}
  return {
    mockRequireOwner: vi.fn(),
    MockForbiddenError,
    mockGetCaldavAccount: vi.fn(),
    mockSaveCaldavAccount: vi.fn(),
    mockDeleteCaldavAccount: vi.fn(),
    mockRunCalendarSyncWorker: vi.fn(),
  };
});

vi.mock('@/server/auth/guards', () => ({
  requireOwner: mockRequireOwner,
  ForbiddenError: MockForbiddenError,
}));

vi.mock('@/server/integrations/caldav/repo', () => ({
  getCaldavAccount: mockGetCaldavAccount,
  saveCaldavAccount: mockSaveCaldavAccount,
  deleteCaldavAccount: mockDeleteCaldavAccount,
}));

vi.mock('@/server/worker/calendar-sync-worker', () => ({
  runCalendarSyncWorker: mockRunCalendarSyncWorker,
}));

// Mock vault
vi.mock('@/server/crypto/vault', () => ({
  encryptSecret: vi.fn().mockResolvedValue('v1:mock_iv:mock_tag:mock_cipher'),
  decryptSecret: vi.fn().mockResolvedValue('decrypted_password'),
}));

// Mock db client
vi.mock('@/server/db/client', () => ({
  db: {},
}));

// Mock audit
vi.mock('@/server/audit', () => ({
  audit: vi.fn().mockResolvedValue({}),
}));

// Mock logger
vi.mock('@/server/log', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  testCaldavConnectionAction,
  saveCaldavAccountAction,
  disconnectCaldavAccountAction,
  triggerManualCaldavSyncAction,
  getCaldavAccountStatusAction,
} from '@/server/integrations/caldav/actions';

describe('TASK-0047: CalDAV Server Actions AuthZ and Boundary Validation (AC-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-8: denies testCaldavConnectionAction when unauthenticated', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('Unauthenticated'));

    const res = await testCaldavConnectionAction({
      serverUrl: 'https://caldav.icloud.com',
      username: 'photographer@icloud.com',
      password: 'app-specific-password',
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('UNAUTHENTICATED');
  });

  it('AC-8: denies saveCaldavAccountAction when unauthenticated', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('Unauthenticated'));

    const res = await saveCaldavAccountAction({
      serverUrl: 'https://caldav.icloud.com',
      username: 'photographer@icloud.com',
      password: 'app-specific-password',
      selectedCalendarUrl: '/12345/calendars/work/',
      selectedCalendarName: 'Work',
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('UNAUTHENTICATED');
  });

  it('AC-8: denies disconnectCaldavAccountAction when unauthenticated', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('Unauthenticated'));

    const res = await disconnectCaldavAccountAction();

    expect(res.success).toBe(false);
    expect(res.code).toBe('UNAUTHENTICATED');
  });

  it('AC-8: denies triggerManualCaldavSyncAction when unauthenticated', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('Unauthenticated'));

    const res = await triggerManualCaldavSyncAction();

    expect(res.success).toBe(false);
    expect(res.code).toBe('UNAUTHENTICATED');
  });

  it('AC-8: denies getCaldavAccountStatusAction when unauthenticated', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('Unauthenticated'));

    const res = await getCaldavAccountStatusAction();

    expect(res.success).toBe(false);
    expect(res.code).toBe('UNAUTHENTICATED');
  });

  it('AC-8: fails with VALIDATION_FAILED when input is malformed or invalid URL', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });

    const res = await testCaldavConnectionAction({
      serverUrl: 'not-a-valid-url',
      username: '',
      password: '',
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  it('AC-8: denies actions with FORBIDDEN when user lacks owner role', async () => {
    mockRequireOwner.mockRejectedValueOnce(new MockForbiddenError('Forbidden'));
    const resTest = await testCaldavConnectionAction({});
    expect(resTest.code).toBe('FORBIDDEN');

    mockRequireOwner.mockRejectedValueOnce(new MockForbiddenError('Forbidden'));
    const resSave = await saveCaldavAccountAction({});
    expect(resSave.code).toBe('FORBIDDEN');

    mockRequireOwner.mockRejectedValueOnce(new MockForbiddenError('Forbidden'));
    const resDisc = await disconnectCaldavAccountAction();
    expect(resDisc.code).toBe('FORBIDDEN');

    mockRequireOwner.mockRejectedValueOnce(new MockForbiddenError('Forbidden'));
    const resSync = await triggerManualCaldavSyncAction();
    expect(resSync.code).toBe('FORBIDDEN');

    mockRequireOwner.mockRejectedValueOnce(new MockForbiddenError('Forbidden'));
    const resStatus = await getCaldavAccountStatusAction();
    expect(resStatus.code).toBe('FORBIDDEN');
  });

  it('AC-8: saveCaldavAccountAction fails with VALIDATION_FAILED on invalid input', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });

    const res = await saveCaldavAccountAction({
      serverUrl: 'invalid',
    });
    expect(res.success).toBe(false);
    expect(res.code).toBe('VALIDATION_FAILED');
  });

  it('AC-8: triggerManualCaldavSyncAction returns ERROR when no CalDAV account exists', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });
    mockGetCaldavAccount.mockResolvedValueOnce(null);

    const res = await triggerManualCaldavSyncAction();
    expect(res.success).toBe(false);
    expect(res.code).toBe('ERROR');
    expect(res.error).toContain('not connected');
  });

  it('AC-8: getCaldavAccountStatusAction returns connected: false when no account exists', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });
    mockGetCaldavAccount.mockResolvedValueOnce(null);

    const res = await getCaldavAccountStatusAction();
    expect(res.success).toBe(true);
    expect(res.data?.connected).toBe(false);
    expect(res.data?.account).toBeNull();
  });

  it('AC-8: getCaldavAccountStatusAction returns connected: true with account details when account exists', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });
    mockGetCaldavAccount.mockResolvedValueOnce({
      id: 'caldav-acc-1',
      serverUrl: 'https://caldav.icloud.com',
      username: 'photographer@icloud.com',
      selectedCalendarUrl: '/cal/1/',
      selectedCalendarName: 'Client Shoots',
      lastSyncedAt: new Date('2026-10-24T00:00:00Z'),
      lastSyncError: null,
      createdAt: new Date('2026-10-23T00:00:00Z'),
    });

    const res = await getCaldavAccountStatusAction();
    expect(res.success).toBe(true);
    expect(res.data?.connected).toBe(true);
    expect(res.data?.account?.id).toBe('caldav-acc-1');
    expect(res.data?.account?.selectedCalendarName).toBe('Client Shoots');
  });

  it('AC-8: triggerManualCaldavSyncAction triggers worker successfully when account is connected', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });
    mockGetCaldavAccount.mockResolvedValueOnce({
      id: 'caldav-acc-1',
      serverUrl: 'https://caldav.icloud.com',
      username: 'photographer@icloud.com',
    });
    mockRunCalendarSyncWorker.mockResolvedValueOnce({
      batchSize: 20,
      syncedCount: 2,
      failedCount: 0,
      durationMs: 150,
      inboundBusyCount: 5,
    });

    const res = await triggerManualCaldavSyncAction();
    expect(res.success).toBe(true);
    expect(res.data?.syncedCount).toBe(2);
  });

  it('AC-8: triggerManualCaldavSyncAction returns ERROR when sync worker throws', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });
    mockGetCaldavAccount.mockResolvedValueOnce({
      id: 'caldav-acc-1',
      serverUrl: 'https://caldav.icloud.com',
      username: 'photographer@icloud.com',
    });
    mockRunCalendarSyncWorker.mockRejectedValueOnce(new Error('Connection timed out'));

    const res = await triggerManualCaldavSyncAction();
    expect(res.success).toBe(false);
    expect(res.code).toBe('ERROR');
    expect(res.error).toBe('Connection timed out');
  });

  it('AC-8: disconnectCaldavAccountAction returns ERROR when repo operation throws', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });
    mockDeleteCaldavAccount.mockRejectedValueOnce(new Error('Database lock timeout'));

    const res = await disconnectCaldavAccountAction();
    expect(res.success).toBe(false);
    expect(res.code).toBe('ERROR');
    expect(res.error).toBe('Database lock timeout');
  });

  it('AC-8: saveCaldavAccountAction returns ERROR when repo operation throws', async () => {
    mockRequireOwner.mockResolvedValueOnce({
      user: { id: 'owner-1', email: 'owner@example.com' },
    });
    mockSaveCaldavAccount.mockRejectedValueOnce(new Error('Constraint violation'));

    const res = await saveCaldavAccountAction({
      serverUrl: 'https://caldav.icloud.com',
      username: 'photographer@icloud.com',
      password: 'password123',
      selectedCalendarUrl: '/123/cal/',
      selectedCalendarName: 'Work',
    });

    expect(res.success).toBe(false);
    expect(res.code).toBe('ERROR');
    expect(res.error).toBe('Constraint violation');
  });
});
