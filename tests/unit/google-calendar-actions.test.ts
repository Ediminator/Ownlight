import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCookiesSet, mockListCalendars } = vi.hoisted(() => ({
  mockCookiesSet: vi.fn(),
  mockListCalendars: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    set: mockCookiesSet,
    get: vi.fn(),
  }),
}));

import { ForbiddenError, type AuthContext } from '@/server/auth/guards';
import * as guards from '@/server/auth/guards';
import * as service from '@/server/integrations/google/service';
import * as repo from '@/server/integrations/google/repo';
import * as syncWorker from '@/server/worker/calendar-sync-worker';
import type { DbClient } from '@/server/db/client';

vi.mock('@/server/auth/guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/auth/guards')>();
  return {
    ...actual,
    requireOwner: vi.fn(),
  };
});

vi.mock('@/server/integrations/google/service', () => ({
  getGoogleIntegrationStatus: vi.fn(),
  buildGoogleAuthorizationUrl: vi.fn(),
}));

vi.mock('@/server/integrations/google/repo', () => ({
  getGoogleOAuthToken: vi.fn(),
  updateGoogleCalendarSettings: vi.fn(),
}));

vi.mock('@/server/integrations/google/state', () => ({
  createOAuthStateCookie: vi.fn().mockResolvedValue('encrypted-state-cookie-value'),
  GOOGLE_OAUTH_STATE_COOKIE: 'google_oauth_state',
  SECURE_GOOGLE_OAUTH_STATE_COOKIE: '__Secure-google_oauth_state',
  OAUTH_STATE_TTL_MS: 600000,
}));

vi.mock('@/server/worker/calendar-sync-worker', () => ({
  runCalendarSyncWorker: vi.fn(),
}));

vi.mock('@/server/integrations/google/calendar-client', () => {
  return {
    GoogleCalendarClient: class {
      listCalendars = mockListCalendars;
    },
    GOOGLE_CALENDAR_SCOPE: 'https://www.googleapis.com/auth/calendar.events',
  };
});

import {
  startGoogleCalendarAuthAction,
  toggleGoogleCalendarSyncAction,
  selectGoogleCalendarAction,
  triggerManualCalendarSyncAction,
  getGoogleCalendarSettingsAction,
} from '@/server/integrations/google/calendar-actions';

describe('Google Calendar Server Actions (TASK-0046: AC-1, AC-7, AC-8)', () => {
  const dummyClient = {} as DbClient;

  const mockOwnerAuth: AuthContext = {
    user: {
      id: 'owner-uuid-1',
      name: 'Test Owner',
      email: 'owner@example.org',
      role: 'owner',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    authType: 'session',
    scopes: ['*'],
  };

  function createMockToken(overrides: Partial<repo.GoogleOAuthToken> = {}): repo.GoogleOAuthToken {
    return {
      id: 'tok-1',
      provider: 'google',
      encryptedRefreshToken: 'enc-refresh',
      accessToken: 'enc-access',
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      scope: 'https://www.googleapis.com/auth/calendar.events',
      calendarSyncEnabled: true,
      selectedCalendarId: 'primary',
      lastCalendarSyncAt: null,
      lastCalendarSyncError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('startGoogleCalendarAuthAction (AC-1, AC-8)', () => {
    it('AC-8: returns FORBIDDEN if caller is not owner', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new ForbiddenError('Forbidden'));

      const result = await startGoogleCalendarAuthAction(undefined, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('AC-8: returns UNAUTHENTICATED if caller is unauthenticated', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new Error('Unauthenticated'));

      const result = await startGoogleCalendarAuthAction(undefined, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('AC-8: returns NOT_CONFIGURED when Google OAuth credentials are not set', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(service.getGoogleIntegrationStatus).mockResolvedValueOnce({
        status: 'unconfigured',
        configured: false,
        connected: false,
        scope: null,
      });

      const result = await startGoogleCalendarAuthAction(undefined, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_CONFIGURED');
    });

    it('AC-1: initiates flow, writes state cookie, and returns authorization URL with incremental scope', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(service.getGoogleIntegrationStatus).mockResolvedValueOnce({
        status: 'connected',
        configured: true,
        connected: true,
        scope: 'https://www.googleapis.com/auth/contacts',
      });
      vi.mocked(service.buildGoogleAuthorizationUrl).mockReturnValueOnce(
        'https://accounts.google.com/o/oauth2/v2/auth?client_id=cid&include_granted_scopes=true',
      );

      const result = await startGoogleCalendarAuthAction('https://studio.example.com', dummyClient);
      expect(result.success).toBe(true);
      expect(result.data?.url).toContain('include_granted_scopes=true');
      expect(mockCookiesSet).toHaveBeenCalledWith(
        expect.any(String),
        'encrypted-state-cookie-value',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
      );
    });

    it('AC-1: falls back to default localhost URL if baseUrl is empty', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(service.getGoogleIntegrationStatus).mockResolvedValueOnce({
        status: 'connected',
        configured: true,
        connected: true,
        scope: 'https://www.googleapis.com/auth/contacts',
      });
      vi.mocked(service.buildGoogleAuthorizationUrl).mockReturnValueOnce(
        'https://accounts.google.com',
      );

      const originalAuthUrl = process.env.AUTH_URL;
      delete process.env.AUTH_URL;

      const result = await startGoogleCalendarAuthAction(undefined, dummyClient);
      expect(result.success).toBe(true);

      if (originalAuthUrl) {
        process.env.AUTH_URL = originalAuthUrl;
      }
    });
  });

  describe('toggleGoogleCalendarSyncAction (AC-7, AC-8)', () => {
    it('AC-8: returns FORBIDDEN if caller is not owner', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new ForbiddenError('Forbidden'));

      const result = await toggleGoogleCalendarSyncAction({ enabled: true }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('AC-8: returns UNAUTHENTICATED if caller is unauthenticated', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new Error('Unauthenticated'));

      const result = await toggleGoogleCalendarSyncAction({ enabled: true }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('AC-7: returns VALIDATION_FAILED when payload is invalid', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);

      const result = await toggleGoogleCalendarSyncAction({ enabled: 'not-a-bool' }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_FAILED');
    });

    it('AC-7: returns NOT_CONFIGURED when no token record exists', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(null);

      const result = await toggleGoogleCalendarSyncAction({ enabled: true }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_CONFIGURED');
    });

    it('AC-7: returns ERROR when enabling sync without calendar scope', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(
        createMockToken({
          scope: 'https://www.googleapis.com/auth/contacts',
          calendarSyncEnabled: false,
        }),
      );

      const result = await toggleGoogleCalendarSyncAction({ enabled: true }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('ERROR');
      expect(result.error).toContain('Google Calendar scope is not authorized');
    });

    it('AC-7: enables sync successfully when calendar scope is present', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(
        createMockToken({
          scope: 'https://www.googleapis.com/auth/calendar.events',
          calendarSyncEnabled: false,
        }),
      );

      const result = await toggleGoogleCalendarSyncAction({ enabled: true }, dummyClient);
      expect(result.success).toBe(true);
      expect(result.data?.enabled).toBe(true);
      expect(repo.updateGoogleCalendarSettings).toHaveBeenCalledWith(
        { calendarSyncEnabled: true },
        dummyClient,
      );
    });

    it('AC-7: disables sync successfully even if calendar scope is absent', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(
        createMockToken({
          scope: 'https://www.googleapis.com/auth/contacts',
          calendarSyncEnabled: true,
        }),
      );

      const result = await toggleGoogleCalendarSyncAction({ enabled: false }, dummyClient);
      expect(result.success).toBe(true);
      expect(result.data?.enabled).toBe(false);
      expect(repo.updateGoogleCalendarSettings).toHaveBeenCalledWith(
        { calendarSyncEnabled: false },
        dummyClient,
      );
    });
  });

  describe('selectGoogleCalendarAction (AC-7, AC-8)', () => {
    it('AC-8: returns FORBIDDEN if caller is not owner', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new ForbiddenError('Forbidden'));

      const result = await selectGoogleCalendarAction({ calendarId: 'work' }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('AC-8: returns UNAUTHENTICATED if caller is unauthenticated', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new Error('Unauthenticated'));

      const result = await selectGoogleCalendarAction({ calendarId: 'work' }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('AC-7: returns VALIDATION_FAILED when calendarId is invalid/empty', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);

      const result = await selectGoogleCalendarAction({ calendarId: '' }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('VALIDATION_FAILED');
    });

    it('AC-7: returns NOT_CONFIGURED when no token record exists', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(null);

      const result = await selectGoogleCalendarAction({ calendarId: 'work' }, dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_CONFIGURED');
    });

    it('AC-7: updates selected calendar id in repository', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(createMockToken());

      const result = await selectGoogleCalendarAction(
        { calendarId: 'custom-cal-123' },
        dummyClient,
      );
      expect(result.success).toBe(true);
      expect(result.data?.calendarId).toBe('custom-cal-123');
      expect(repo.updateGoogleCalendarSettings).toHaveBeenCalledWith(
        { selectedCalendarId: 'custom-cal-123' },
        dummyClient,
      );
    });
  });

  describe('triggerManualCalendarSyncAction (AC-7, AC-8)', () => {
    it('AC-8: returns FORBIDDEN if caller is not owner', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new ForbiddenError('Forbidden'));

      const result = await triggerManualCalendarSyncAction(dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('AC-8: returns UNAUTHENTICATED if caller is unauthenticated', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new Error('Unauthenticated'));

      const result = await triggerManualCalendarSyncAction(dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('AC-7: returns NOT_CONFIGURED when no token record exists', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(null);

      const result = await triggerManualCalendarSyncAction(dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_CONFIGURED');
    });

    it('AC-7: runs calendar sync worker and returns summary', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(createMockToken());

      vi.mocked(syncWorker.runCalendarSyncWorker).mockResolvedValueOnce({
        batchSize: 2,
        syncedCount: 2,
        failedCount: 0,
        durationMs: 50,
        inboundBusyCount: 5,
      });

      const result = await triggerManualCalendarSyncAction(dummyClient);
      expect(result.success).toBe(true);
      expect(result.data?.syncedCount).toBe(2);
      expect(result.data?.inboundBusyCount).toBe(5);
    });

    it('AC-7: returns ERROR when worker run throws an error', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(createMockToken());

      vi.mocked(syncWorker.runCalendarSyncWorker).mockRejectedValueOnce(
        new Error('Worker failure occurred'),
      );

      const result = await triggerManualCalendarSyncAction(dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('ERROR');
      expect(result.error).toBe('Worker failure occurred');
    });

    it('AC-7: returns generic ERROR when non-error is thrown', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(createMockToken());

      vi.mocked(syncWorker.runCalendarSyncWorker).mockRejectedValueOnce('raw string error');

      const result = await triggerManualCalendarSyncAction(dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('ERROR');
      expect(result.error).toBe('Manual sync failed.');
    });
  });

  describe('getGoogleCalendarSettingsAction (AC-7, AC-8)', () => {
    it('AC-8: returns FORBIDDEN if caller is not owner', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new ForbiddenError('Forbidden'));

      const result = await getGoogleCalendarSettingsAction(dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('FORBIDDEN');
    });

    it('AC-8: returns UNAUTHENTICATED if caller is unauthenticated', async () => {
      vi.mocked(guards.requireOwner).mockRejectedValueOnce(new Error('Unauthenticated'));

      const result = await getGoogleCalendarSettingsAction(dummyClient);
      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });

    it('AC-7: returns settings with fetched calendars when connected and authorized', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(service.getGoogleIntegrationStatus).mockResolvedValueOnce({
        status: 'connected',
        configured: true,
        connected: true,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        hasCalendarScope: true,
      });
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(
        createMockToken({
          selectedCalendarId: 'studio-cal',
          lastCalendarSyncAt: new Date('2026-10-23T12:00:00Z'),
        }),
      );

      mockListCalendars.mockResolvedValueOnce([
        { id: 'primary', summary: 'Primary Calendar', primary: true },
        { id: 'studio-cal', summary: 'Studio Bookings' },
      ]);

      const result = await getGoogleCalendarSettingsAction(dummyClient);
      expect(result.success).toBe(true);
      expect(result.data?.connected).toBe(true);
      expect(result.data?.hasCalendarScope).toBe(true);
      expect(result.data?.calendarSyncEnabled).toBe(true);
      expect(result.data?.selectedCalendarId).toBe('studio-cal');
      expect(result.data?.calendars).toHaveLength(2);
      expect(result.data?.calendars[1]?.summary).toBe('Studio Bookings');
    });

    it('AC-7: falls back to default primary calendar if listCalendars fails', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(service.getGoogleIntegrationStatus).mockResolvedValueOnce({
        status: 'connected',
        configured: true,
        connected: true,
        scope: 'https://www.googleapis.com/auth/calendar.events',
        hasCalendarScope: true,
      });
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(createMockToken());

      mockListCalendars.mockRejectedValueOnce(new Error('Network error'));

      const result = await getGoogleCalendarSettingsAction(dummyClient);
      expect(result.success).toBe(true);
      expect(result.data?.calendars).toEqual([
        { id: 'primary', summary: 'Primary Calendar', primary: true },
      ]);
    });

    it('AC-7: returns default settings when disconnected', async () => {
      vi.mocked(guards.requireOwner).mockResolvedValueOnce(mockOwnerAuth);
      vi.mocked(service.getGoogleIntegrationStatus).mockResolvedValueOnce({
        status: 'disconnected',
        configured: true,
        connected: false,
        scope: null,
        hasCalendarScope: false,
      });
      vi.mocked(repo.getGoogleOAuthToken).mockResolvedValueOnce(null);

      const result = await getGoogleCalendarSettingsAction(dummyClient);
      expect(result.success).toBe(true);
      expect(result.data?.connected).toBe(false);
      expect(result.data?.calendarSyncEnabled).toBe(false);
      expect(result.data?.selectedCalendarId).toBe('primary');
      expect(result.data?.calendars).toHaveLength(1);
    });
  });
});
