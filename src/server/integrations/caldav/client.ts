import 'server-only';
import { createDAVClient, type DAVCalendar } from 'tsdav';
import { logger } from '@/server/log';
import { validateCaldavServerUrl } from './ssrf';
import {
  formatCaldavEvent,
  parseCaldavEventToBusyIntervals,
  type CaldavEventInput,
  type ParsedBusyInterval,
} from './mapping';

export class CaldavApiError extends Error {
  statusCode?: number;
  code?: string;

  constructor(message: string, statusCode?: number, code?: string) {
    super(message);
    this.name = 'CaldavApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface CaldavCalendarItem {
  url: string;
  displayName: string;
  description?: string;
  ctag?: string;
}

export interface CaldavClientOptions {
  serverUrl: string;
  username: string;
  password: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  allowLoopback?: boolean;
}

/**
 * Normalizes calendar display name from tsdav representation.
 */
function extractDisplayName(cal: DAVCalendar, fallbackIndex: number): string {
  if (cal.displayName && typeof cal.displayName === 'string' && cal.displayName.trim()) {
    return cal.displayName.trim();
  }
  // Extract path segment from URL if available
  const segments = cal.url.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (lastSegment && !lastSegment.startsWith('019')) {
    return decodeURIComponent(lastSegment);
  }
  return `Calendar ${String(fallbackIndex + 1)}`;
}

/**
 * CalDAV client leveraging tsdav with SSRF protection, credential isolation,
 * event formatting, and busy interval retrieval.
 */
export class CaldavClient {
  private readonly serverUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly fetchFn?: typeof fetch;
  private readonly timeoutMs: number;
  private readonly allowLoopback: boolean;

  private davClientPromise: ReturnType<typeof createDAVClient> | null = null;

  constructor(options: CaldavClientOptions) {
    // 1. SSRF validation on user-supplied server URL
    this.serverUrl = validateCaldavServerUrl(options.serverUrl, {
      allowLoopback: options.allowLoopback ?? false,
    });
    this.username = options.username;
    this.password = options.password;
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.allowLoopback = options.allowLoopback ?? false;
  }

  private async getClient() {
    this.davClientPromise ??= createDAVClient({
      serverUrl: this.serverUrl,
      credentials: {
        username: this.username,
        password: this.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
      fetch: this.fetchFn,
      fetchOptions: {
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    });
    return this.davClientPromise;
  }

  /**
   * Discovers calendars on the CalDAV server for the configured user account (AC-1).
   */
  async testConnectionAndDiscoverCalendars(): Promise<CaldavCalendarItem[]> {
    try {
      const client = await this.getClient();
      const rawCalendars = await client.fetchCalendars();

      if (!Array.isArray(rawCalendars) || rawCalendars.length === 0) {
        return [];
      }

      return rawCalendars.map((cal, idx) => ({
        url: cal.url,
        displayName: extractDisplayName(cal, idx),
        description: cal.description,
        ctag: cal.ctag,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ error: message, serverUrl: this.serverUrl }, 'CalDAV discovery failed');
      throw new CaldavApiError(`Failed to connect to CalDAV server: ${message}`);
    }
  }

  /**
   * Pushes a new VEVENT object to the selected CalDAV calendar (AC-3).
   */
  async createCalendarEvent(
    calendarUrl: string,
    eventInput: CaldavEventInput,
  ): Promise<{ url: string; etag?: string }> {
    const formatted = formatCaldavEvent(eventInput);
    const client = await this.getClient();

    try {
      const res = await client.createCalendarObject({
        calendar: { url: calendarUrl },
        iCalString: formatted.icalString,
        filename: formatted.filename,
      });

      if (!res.ok && res.status !== 201 && res.status !== 204 && res.status !== 200) {
        throw new CaldavApiError(`CalDAV create failed: HTTP ${String(res.status)}`, res.status);
      }

      const etag = res.headers.get('etag') ?? undefined;
      const cleanCalUrl = calendarUrl.endsWith('/') ? calendarUrl : `${calendarUrl}/`;
      const fullUrl = `${cleanCalUrl}${formatted.filename}`;

      return { url: fullUrl, etag };
    } catch (err) {
      if (err instanceof CaldavApiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new CaldavApiError(`CalDAV event creation error: ${msg}`);
    }
  }

  /**
   * Updates an existing VEVENT object on the CalDAV server (AC-3).
   */
  async updateCalendarEvent(
    eventUrl: string,
    eventInput: CaldavEventInput,
    etag?: string,
  ): Promise<{ url: string; etag?: string }> {
    const formatted = formatCaldavEvent(eventInput);
    const client = await this.getClient();

    try {
      const res = await client.updateCalendarObject({
        calendarObject: {
          url: eventUrl,
          data: formatted.icalString,
          etag,
        },
      });

      if (!res.ok && res.status !== 200 && res.status !== 204) {
        throw new CaldavApiError(`CalDAV update failed: HTTP ${String(res.status)}`, res.status);
      }

      const newEtag = res.headers.get('etag') ?? etag;
      return { url: eventUrl, etag: newEtag };
    } catch (err) {
      if (err instanceof CaldavApiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new CaldavApiError(`CalDAV event update error: ${msg}`);
    }
  }

  /**
   * Deletes a VEVENT object from the CalDAV server (AC-3).
   * Idempotent: 404 or 410 is treated as a successful deletion.
   */
  async deleteCalendarEvent(eventUrl: string, etag?: string): Promise<void> {
    const client = await this.getClient();

    try {
      const res = await client.deleteCalendarObject({
        calendarObject: {
          url: eventUrl,
          etag,
        },
      });

      if (
        !res.ok &&
        res.status !== 404 &&
        res.status !== 410 &&
        res.status !== 204 &&
        res.status !== 200
      ) {
        throw new CaldavApiError(`CalDAV delete failed: HTTP ${String(res.status)}`, res.status);
      }
    } catch (err) {
      if (err instanceof CaldavApiError && (err.statusCode === 404 || err.statusCode === 410)) {
        return; // Idempotent
      }
      if (err instanceof CaldavApiError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new CaldavApiError(`CalDAV event deletion error: ${msg}`);
    }
  }

  /**
   * Fetches calendar objects in a time window to extract busy intervals (AC-4).
   */
  async fetchBusyIntervals(
    calendarUrl: string,
    timeRange: { start: Date; end: Date },
  ): Promise<ParsedBusyInterval[]> {
    const client = await this.getClient();

    try {
      const objects = await client.fetchCalendarObjects({
        calendar: { url: calendarUrl },
        timeRange: {
          start: timeRange.start.toISOString(),
          end: timeRange.end.toISOString(),
        },
        expand: true,
      });

      const intervals: ParsedBusyInterval[] = [];
      for (const obj of objects) {
        if (typeof obj.data === 'string') {
          const parsed = parseCaldavEventToBusyIntervals(obj.data);
          intervals.push(...parsed);
        }
      }

      return intervals;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'Inbound CalDAV busy interval query encountered an issue',
      );
      return [];
    }
  }
}
