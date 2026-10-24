import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock logger
vi.mock('@/server/log', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockFetchCalendars = vi.fn();
const mockCreateCalendarObject = vi.fn();
const mockUpdateCalendarObject = vi.fn();
const mockDeleteCalendarObject = vi.fn();
const mockFetchCalendarObjects = vi.fn();

vi.mock('tsdav', () => ({
  createDAVClient: vi.fn().mockImplementation(() =>
    Promise.resolve({
      fetchCalendars: mockFetchCalendars,
      createCalendarObject: mockCreateCalendarObject,
      updateCalendarObject: mockUpdateCalendarObject,
      deleteCalendarObject: mockDeleteCalendarObject,
      fetchCalendarObjects: mockFetchCalendarObjects,
    }),
  ),
}));

import { CaldavClient, CaldavApiError } from '@/server/integrations/caldav/client';

describe('TASK-0047: CaldavClient Unit Tests (AC-1, AC-3, AC-4)', () => {
  let client: CaldavClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new CaldavClient({
      serverUrl: 'https://caldav.example.com/dav',
      username: 'user@example.com',
      password: 'password123',
    });
  });

  describe('testConnectionAndDiscoverCalendars (AC-1)', () => {
    it('returns empty array when no calendars found', async () => {
      mockFetchCalendars.mockResolvedValueOnce([]);
      const cals = await client.testConnectionAndDiscoverCalendars();
      expect(cals).toEqual([]);
    });

    it('extracts display name using displayName, path segment, and fallback index', async () => {
      mockFetchCalendars.mockResolvedValueOnce([
        { url: '/dav/cal1/', displayName: 'Work' },
        { url: '/dav/personal-shoots/', displayName: '' },
        { url: '/dav/01920000-0000-7000-8000-000000000001/', displayName: '' },
      ]);

      const cals = await client.testConnectionAndDiscoverCalendars();
      expect(cals).toHaveLength(3);
      expect(cals[0]?.displayName).toBe('Work');
      expect(cals[1]?.displayName).toBe('personal-shoots');
      expect(cals[2]?.displayName).toBe('Calendar 3');
    });

    it('throws CaldavApiError on discovery failure', async () => {
      mockFetchCalendars.mockRejectedValueOnce(new Error('Network offline'));
      await expect(client.testConnectionAndDiscoverCalendars()).rejects.toThrow(CaldavApiError);
    });
  });

  describe('createCalendarEvent (AC-3)', () => {
    it('throws CaldavApiError when HTTP status is not ok or 201/204', async () => {
      mockCreateCalendarObject.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
      });

      await expect(
        client.createCalendarEvent('/dav/cal1/', {
          studioName: 'Studio',
          entityType: 'shoot',
          entity: {
            id: '01920000-0000-7000-8000-000000000001',
            title: 'Shoot',
            startsAt: new Date(),
            endsAt: new Date(),
          },
        }),
      ).rejects.toThrow('CalDAV create failed: HTTP 500');
    });

    it('wraps unexpected create error in CaldavApiError', async () => {
      mockCreateCalendarObject.mockRejectedValueOnce(new Error('Socket hung up'));

      await expect(
        client.createCalendarEvent('/dav/cal1/', {
          studioName: 'Studio',
          entityType: 'shoot',
          entity: {
            id: '01920000-0000-7000-8000-000000000001',
            title: 'Shoot',
            startsAt: new Date(),
            endsAt: new Date(),
          },
        }),
      ).rejects.toThrow('CalDAV event creation error: Socket hung up');
    });
  });

  describe('updateCalendarEvent (AC-3)', () => {
    it('throws CaldavApiError when HTTP update response status is not ok', async () => {
      mockUpdateCalendarObject.mockResolvedValueOnce({
        ok: false,
        status: 412,
        headers: new Headers(),
      });

      await expect(
        client.updateCalendarEvent('/dav/cal1/event1.ics', {
          studioName: 'Studio',
          entityType: 'shoot',
          entity: {
            id: '01920000-0000-7000-8000-000000000001',
            title: 'Updated Shoot',
            startsAt: new Date(),
            endsAt: new Date(),
          },
        }),
      ).rejects.toThrow('CalDAV update failed: HTTP 412');
    });

    it('wraps unexpected update error in CaldavApiError', async () => {
      mockUpdateCalendarObject.mockRejectedValueOnce(new Error('TLS error'));

      await expect(
        client.updateCalendarEvent('/dav/cal1/event1.ics', {
          studioName: 'Studio',
          entityType: 'shoot',
          entity: {
            id: '01920000-0000-7000-8000-000000000001',
            title: 'Updated Shoot',
            startsAt: new Date(),
            endsAt: new Date(),
          },
        }),
      ).rejects.toThrow('CalDAV event update error: TLS error');
    });
  });

  describe('deleteCalendarEvent (AC-3)', () => {
    it('treats HTTP 404 and 410 as successful idempotent deletion', async () => {
      mockDeleteCalendarObject.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(client.deleteCalendarEvent('/dav/cal1/event1.ics')).resolves.toBeUndefined();

      mockDeleteCalendarObject.mockResolvedValueOnce({
        ok: false,
        status: 410,
      });

      await expect(client.deleteCalendarEvent('/dav/cal1/event1.ics')).resolves.toBeUndefined();
    });

    it('throws CaldavApiError on HTTP 500 delete response', async () => {
      mockDeleteCalendarObject.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(client.deleteCalendarEvent('/dav/cal1/event1.ics')).rejects.toThrow(
        'CalDAV delete failed: HTTP 500',
      );
    });

    it('wraps unexpected delete error in CaldavApiError', async () => {
      mockDeleteCalendarObject.mockRejectedValueOnce(new Error('Disk full'));

      await expect(client.deleteCalendarEvent('/dav/cal1/event1.ics')).rejects.toThrow(
        'CalDAV event deletion error: Disk full',
      );
    });
  });

  describe('fetchBusyIntervals (AC-4)', () => {
    it('catches fetch exceptions and returns empty array safely', async () => {
      mockFetchCalendarObjects.mockRejectedValueOnce(new Error('Server unavailable'));

      const intervals = await client.fetchBusyIntervals('/dav/cal1/', {
        start: new Date('2026-11-01T00:00:00Z'),
        end: new Date('2026-11-30T00:00:00Z'),
      });

      expect(intervals).toEqual([]);
    });

    it('skips objects without string data', async () => {
      mockFetchCalendarObjects.mockResolvedValueOnce([{ url: '/dav/cal1/obj1.ics', data: null }]);

      const intervals = await client.fetchBusyIntervals('/dav/cal1/', {
        start: new Date('2026-11-01T00:00:00Z'),
        end: new Date('2026-11-30T00:00:00Z'),
      });

      expect(intervals).toEqual([]);
    });
  });
});
