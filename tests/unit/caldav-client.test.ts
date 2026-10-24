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

    it('returns full URL and etag when calendarUrl lacks trailing slash and etag header is present', async () => {
      const headers = new Headers();
      headers.set('etag', '"etag-123"');
      mockCreateCalendarObject.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers,
      });

      const res = await client.createCalendarEvent('/dav/cal1', {
        studioName: 'Studio',
        entityType: 'shoot',
        entity: {
          id: '01920000-0000-7000-8000-000000000001',
          title: 'Shoot',
          startsAt: new Date(),
          endsAt: new Date(),
        },
      });

      expect(res.etag).toBe('"etag-123"');
      expect(res.url).toContain('/dav/cal1/');
    });

    it('wraps non-Error rejection in CaldavApiError for createCalendarEvent', async () => {
      mockCreateCalendarObject.mockRejectedValueOnce('raw-create-fail');

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
      ).rejects.toThrow('CalDAV event creation error: raw-create-fail');
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

    it('returns new etag when update response provides etag or falls back to passed etag', async () => {
      const headers = new Headers();
      headers.set('etag', '"new-etag"');
      mockUpdateCalendarObject.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers,
      });

      const res = await client.updateCalendarEvent(
        '/dav/cal1/event1.ics',
        {
          studioName: 'Studio',
          entityType: 'shoot',
          entity: {
            id: '01920000-0000-7000-8000-000000000001',
            title: 'Shoot',
            startsAt: new Date(),
            endsAt: new Date(),
          },
        },
        '"old-etag"',
      );

      expect(res.etag).toBe('"new-etag"');

      // Fallback to passed etag when response headers lack etag
      mockUpdateCalendarObject.mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers(),
      });

      const fallbackRes = await client.updateCalendarEvent(
        '/dav/cal1/event1.ics',
        {
          studioName: 'Studio',
          entityType: 'shoot',
          entity: {
            id: '01920000-0000-7000-8000-000000000001',
            title: 'Shoot',
            startsAt: new Date(),
            endsAt: new Date(),
          },
        },
        '"fallback-etag"',
      );

      expect(fallbackRes.etag).toBe('"fallback-etag"');
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

    it('wraps non-Error rejection in CaldavApiError for updateCalendarEvent', async () => {
      mockUpdateCalendarObject.mockRejectedValueOnce('raw-update-fail');

      await expect(
        client.updateCalendarEvent('/dav/cal1/event1.ics', {
          studioName: 'Studio',
          entityType: 'shoot',
          entity: {
            id: '01920000-0000-7000-8000-000000000001',
            title: 'Shoot',
            startsAt: new Date(),
            endsAt: new Date(),
          },
        }),
      ).rejects.toThrow('CalDAV event update error: raw-update-fail');
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

    it('handles CaldavApiError with 404 or 410 thrown in catch block as idempotent deletion', async () => {
      mockDeleteCalendarObject.mockRejectedValueOnce(new CaldavApiError('Not found', 404));
      await expect(client.deleteCalendarEvent('/dav/cal1/event1.ics')).resolves.toBeUndefined();

      mockDeleteCalendarObject.mockRejectedValueOnce(new CaldavApiError('Gone', 410));
      await expect(client.deleteCalendarEvent('/dav/cal1/event1.ics')).resolves.toBeUndefined();

      mockDeleteCalendarObject.mockRejectedValueOnce('raw-string-error');
      await expect(client.deleteCalendarEvent('/dav/cal1/event1.ics')).rejects.toThrow(
        'CalDAV event deletion error: raw-string-error',
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

    it('parses valid calendar objects and handles non-Error catch safely', async () => {
      const sampleIcal = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:sample-busy@example.org',
        'DTSTART:20261120T100000Z',
        'DTEND:20261120T110000Z',
        'SUMMARY:Busy',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      mockFetchCalendarObjects.mockResolvedValueOnce([
        { url: '/dav/cal1/obj1.ics', data: sampleIcal },
      ]);

      const intervals = await client.fetchBusyIntervals('/dav/cal1/', {
        start: new Date('2026-11-01T00:00:00Z'),
        end: new Date('2026-11-30T00:00:00Z'),
      });

      expect(intervals).toHaveLength(1);
      expect(intervals[0]?.externalId).toBe('sample-busy@example.org');

      mockFetchCalendarObjects.mockRejectedValueOnce('raw-fetch-failure');
      const empty = await client.fetchBusyIntervals('/dav/cal1/', {
        start: new Date('2026-11-01T00:00:00Z'),
        end: new Date('2026-11-30T00:00:00Z'),
      });
      expect(empty).toEqual([]);
    });
  });
});
