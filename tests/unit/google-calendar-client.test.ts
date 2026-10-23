import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  GoogleCalendarClient,
  CalendarApiError,
  formatCalendarEventSummary,
  sanitizeClientNameForCalendar,
} from '@/server/integrations/google/calendar-client';

describe('GoogleCalendarClient Unit Tests (AC-2, AC-3, AC-4, AC-5)', () => {
  const fakeToken = 'ya29.test-mock-token';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('PII Minimization and Event Summary Formatting', () => {
    it('handles various name formats in sanitizeClientNameForCalendar', () => {
      expect(sanitizeClientNameForCalendar(undefined)).toBe('Client');
      expect(sanitizeClientNameForCalendar('')).toBe('Client');
      expect(sanitizeClientNameForCalendar('   ')).toBe('Client');
      expect(sanitizeClientNameForCalendar('Madonna')).toBe('Madonna');
      expect(sanitizeClientNameForCalendar('Ludwig van Beethoven')).toBe('Ludwig B.');
    });

    it('formats summary for appointment without attendee or studio name', () => {
      const summary1 = formatCalendarEventSummary({
        entityType: 'appointment',
        title: 'Initial Meeting: John Doe',
      });
      expect(summary1).toBe('Ownlight - Initial Meeting');

      const summary2 = formatCalendarEventSummary({
        studioName: '',
        entityType: 'appointment',
        title: '',
        attendeeName: 'Jane Austen',
      });
      expect(summary2).toBe('Ownlight - Consultation: Jane A.');
    });

    it('formats summary for shoot and blocked_time', () => {
      const shootSummary = formatCalendarEventSummary({
        studioName: 'Studio Lux',
        entityType: 'shoot',
        title: 'Engagement Shoot',
      });
      expect(shootSummary).toBe('Studio Lux - Shoot: Engagement Shoot');

      const shootSummaryWithAttendee = formatCalendarEventSummary({
        studioName: 'Studio Lux',
        entityType: 'shoot',
        title: 'Portraits',
        attendeeName: 'Max Mustermann',
      });
      expect(shootSummaryWithAttendee).toBe('Studio Lux - Shoot: Portraits: Max M.');

      const shootSummaryAlreadyHasAttendee = formatCalendarEventSummary({
        studioName: 'Studio Lux',
        entityType: 'shoot',
        title: 'Portraits: Max M.',
        attendeeName: 'Max Mustermann',
      });
      expect(shootSummaryAlreadyHasAttendee).toBe('Studio Lux - Shoot: Portraits: Max M.');

      const blockedSummary = formatCalendarEventSummary({
        studioName: 'Studio Lux',
        entityType: 'blocked_time',
        title: 'Maintenance Day',
      });
      expect(blockedSummary).toBe('Studio Lux - Blocked: Maintenance Day');
    });
  });

  describe('GoogleCalendarClient API Methods', () => {
    it('insertEvent: sends POST request with Authorization header and parses response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () =>
          await Promise.resolve({
            id: 'evt_123',
            etag: '"etag_123"',
            hangoutLink: 'https://meet.google.com/abc-xyz',
            htmlLink: 'https://calendar.google.com/evt_123',
          }),
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      const result = await client.insertEvent(
        'primary',
        {
          summary: 'Consultation: Clara S.',
          start: { dateTime: '2026-11-10T10:00:00Z' },
          end: { dateTime: '2026-11-10T11:00:00Z' },
        },
        { conferenceDataVersion: 1 },
      );

      expect(result.id).toBe('evt_123');
      expect(result.etag).toBe('"etag_123"');
      expect(result.hangoutLink).toBe('https://meet.google.com/abc-xyz');

      const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(calledUrl).toContain('conferenceDataVersion=1');
      expect(calledInit.headers).toEqual(
        expect.objectContaining({
          Authorization: `Bearer ${fakeToken}`,
        }),
      );
    });

    it('updateEvent: sends PUT request and returns updated event details', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () =>
          await Promise.resolve({
            id: 'evt_123',
            etag: '"etag_updated"',
          }),
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      const result = await client.updateEvent('primary', 'evt_123', {
        summary: 'Updated Consultation: Clara S.',
        start: { dateTime: '2026-11-10T10:00:00Z' },
        end: { dateTime: '2026-11-10T11:00:00Z' },
      });

      expect(result.id).toBe('evt_123');
      expect(result.etag).toBe('"etag_updated"');
    });

    it('deleteEvent: sends DELETE request and returns true on success', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      const deleted = await client.deleteEvent('primary', 'evt_123');
      expect(deleted).toBe(true);
    });

    it('listCalendars: returns parsed calendar list with primary flag', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () =>
          await Promise.resolve({
            items: [
              { id: 'primary', summary: 'Primary Calendar', primary: true },
              { id: 'second_cal', summary: 'Studio 2', primary: false },
              { summary: 'Ignored missing id' },
            ],
          }),
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      const list = await client.listCalendars();
      expect(list).toHaveLength(2);
      expect(list[0]?.id).toBe('primary');
      expect(list[0]?.primary).toBe(true);
      expect(list[1]?.id).toBe('second_cal');
      expect(list[1]?.primary).toBe(false);
    });

    it('handles HTTP error responses (500, 404, 429) by throwing CalendarApiError with retry flags', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      await expect(
        client.insertEvent('primary', {
          summary: 'Test',
          start: {},
          end: {},
        }),
      ).rejects.toThrow(CalendarApiError);

      try {
        await client.insertEvent('primary', {
          summary: 'Test',
          start: {},
          end: {},
        });
      } catch (err) {
        expect(err).toBeInstanceOf(CalendarApiError);
        const calErr = err as CalendarApiError;
        expect(calErr.statusCode).toBe(503);
        expect(calErr.isRetryable).toBe(true);
      }
    });

    it('handles network timeouts by throwing retryable 408 CalendarApiError', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.name = 'TimeoutError';
      const mockFetch = vi.fn().mockRejectedValue(timeoutError);

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      await expect(
        client.queryFreeBusy('primary', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z'),
      ).rejects.toThrow(CalendarApiError);

      try {
        await client.queryFreeBusy('primary', '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z');
      } catch (err) {
        expect(err).toBeInstanceOf(CalendarApiError);
        const calErr = err as CalendarApiError;
        expect(calErr.statusCode).toBe(408);
        expect(calErr.isRetryable).toBe(true);
      }
    });

    it('handles network failure in deleteEvent by throwing CalendarApiError', async () => {
      const networkError = new Error('Connection refused');
      const mockFetch = vi.fn().mockRejectedValue(networkError);

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      await expect(client.deleteEvent('primary', 'evt_123')).rejects.toThrow(CalendarApiError);
    });

    it('handles network failure in listCalendars by throwing CalendarApiError', async () => {
      const networkError = new Error('Network failure');
      const mockFetch = vi.fn().mockRejectedValue(networkError);

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      await expect(client.listCalendars()).rejects.toThrow(CalendarApiError);
    });

    it('handles HTTP error in listCalendars', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      await expect(client.listCalendars()).rejects.toThrow(CalendarApiError);
    });

    it('handles timeout in listCalendars mapping to 408', async () => {
      const timeoutErr = new Error('Abort');
      timeoutErr.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(timeoutErr);

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      await expect(client.listCalendars()).rejects.toMatchObject({ statusCode: 408 });
    });

    it('listCalendars: handles missing summary and empty items', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => await Promise.resolve({ items: [{ id: 'calendar-without-summary' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => await Promise.resolve({}),
        });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      const list1 = await client.listCalendars();
      expect(list1).toEqual([
        {
          id: 'calendar-without-summary',
          summary: 'calendar-without-summary',
          primary: false,
          description: undefined,
        },
      ]);

      const list2 = await client.listCalendars();
      expect(list2).toEqual([]);
    });

    it('insertEvent: extracts hangoutLink from conferenceData entryPoints when hangoutLink is absent', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () =>
          await Promise.resolve({
            id: 'evt_conf_1',
            conferenceData: {
              entryPoints: [
                { entryPointType: 'phone', uri: 'tel:+123' },
                { entryPointType: 'video', uri: 'https://meet.google.com/conf-video-xyz' },
              ],
            },
          }),
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      const result = await client.insertEvent('primary', {
        summary: 'Consultation',
        start: {},
        end: {},
      });

      expect(result.hangoutLink).toBe('https://meet.google.com/conf-video-xyz');
    });

    it('updateEvent: handles network failure and HTTP 500 errors', async () => {
      const mockFetch = vi.fn().mockRejectedValueOnce(new Error('Network drop'));

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      await expect(
        client.updateEvent('primary', 'evt_1', { summary: 'New', start: {}, end: {} }),
      ).rejects.toThrow(CalendarApiError);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        client.updateEvent('primary', 'evt_1', { summary: 'New', start: {}, end: {} }),
      ).rejects.toThrow(CalendarApiError);
    });

    it('updateEvent: extracts hangoutLink from conferenceData', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () =>
          await Promise.resolve({
            id: 'evt_123',
            conferenceData: {
              entryPoints: [
                { entryPointType: 'video', uri: 'https://meet.google.com/updated-video-link' },
              ],
            },
          }),
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      const result = await client.updateEvent(
        'primary',
        'evt_123',
        { summary: 'Updated', start: {}, end: {} },
        { conferenceDataVersion: 1 },
      );
      expect(result.hangoutLink).toBe('https://meet.google.com/updated-video-link');
    });

    it('deleteEvent: treats 404 and 410 as idempotent success', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404 })
        .mockResolvedValueOnce({ ok: false, status: 410 })
        .mockResolvedValueOnce({ ok: false, status: 500 });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      // 404 is idempotent success
      const res404 = await client.deleteEvent('primary', 'evt_404');
      expect(res404).toBe(true);

      // 410 is idempotent success
      const res410 = await client.deleteEvent('primary', 'evt_410');
      expect(res410).toBe(true);

      // 500 throws CalendarApiError
      await expect(client.deleteEvent('primary', 'evt_500')).rejects.toThrow(CalendarApiError);
    });

    it('queryFreeBusy: handles fallback calendar and HTTP errors', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          await Promise.resolve({
            calendars: {
              'fallback-cal-id': {
                busy: [
                  { start: '2026-11-05T09:00:00Z', end: '2026-11-05T10:00:00Z' },
                  { start: null, end: null }, // filtered out
                ],
              },
            },
          }),
      });

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      const intervals = await client.queryFreeBusy(
        'primary',
        '2026-11-05T00:00:00Z',
        '2026-11-06T00:00:00Z',
      );
      expect(intervals).toHaveLength(1);
      expect(intervals[0]?.start).toBe('2026-11-05T09:00:00Z');

      // HTTP 500
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });
      await expect(
        client.queryFreeBusy('primary', '2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z'),
      ).rejects.toThrow(CalendarApiError);

      // Generic network failure
      mockFetch.mockRejectedValueOnce(new Error('Generic network error'));
      await expect(
        client.queryFreeBusy('primary', '2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z'),
      ).rejects.toThrow(CalendarApiError);
    });

    it('insertEvent: handles network timeouts and generic errors', async () => {
      const timeoutErr = new Error('Timeout');
      timeoutErr.name = 'TimeoutError';
      const mockFetch = vi
        .fn()
        .mockRejectedValueOnce(timeoutErr)
        .mockRejectedValueOnce(new Error('Connection lost'));

      const client = new GoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      vi.spyOn(client, 'getValidAccessToken').mockResolvedValue(fakeToken);

      await expect(
        client.insertEvent('primary', { summary: 'A', start: {}, end: {} }),
      ).rejects.toThrow(CalendarApiError);

      await expect(
        client.insertEvent('primary', { summary: 'A', start: {}, end: {} }),
      ).rejects.toThrow(CalendarApiError);
    });
  });

  describe('getValidAccessToken Error Mapping', () => {
    it('maps GoogleOAuthError to CalendarApiError', async () => {
      const service = await import('@/server/integrations/google/service');
      const spy = vi
        .spyOn(service, 'getValidGoogleAccessToken')
        .mockRejectedValueOnce(new service.GoogleOAuthError('OAuth token expired', 401, false));

      try {
        const client = new GoogleCalendarClient({});
        await expect(client.getValidAccessToken()).rejects.toThrow(CalendarApiError);
      } finally {
        spy.mockRestore();
      }
    });

    it('rethrows CalendarApiError directly', async () => {
      const service = await import('@/server/integrations/google/service');
      const spy = vi
        .spyOn(service, 'getValidGoogleAccessToken')
        .mockRejectedValueOnce(new CalendarApiError('Direct calendar error', 400, false));

      try {
        const client = new GoogleCalendarClient({});
        await expect(client.getValidAccessToken()).rejects.toThrow(CalendarApiError);
      } finally {
        spy.mockRestore();
      }
    });

    it('maps TimeoutError to 408 CalendarApiError', async () => {
      const service = await import('@/server/integrations/google/service');
      const timeoutErr = new Error('Abort');
      timeoutErr.name = 'AbortError';
      const spy = vi.spyOn(service, 'getValidGoogleAccessToken').mockRejectedValueOnce(timeoutErr);

      try {
        const client = new GoogleCalendarClient({});
        await expect(client.getValidAccessToken()).rejects.toMatchObject({ statusCode: 408 });
      } finally {
        spy.mockRestore();
      }
    });

    it('maps generic Error to 502 CalendarApiError', async () => {
      const service = await import('@/server/integrations/google/service');
      const spy = vi
        .spyOn(service, 'getValidGoogleAccessToken')
        .mockRejectedValueOnce(new Error('General failure'));

      try {
        const client = new GoogleCalendarClient({});
        await expect(client.getValidAccessToken()).rejects.toMatchObject({ statusCode: 502 });
      } finally {
        spy.mockRestore();
      }
    });
  });
});
