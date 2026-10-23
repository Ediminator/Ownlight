import 'server-only';
import { logger } from '@/server/log';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { GOOGLE_OAUTH_PURPOSE, getGoogleCalendarApiBase } from './constants';
import { getValidGoogleAccessToken, GoogleOAuthError } from './service';

export class CalendarApiError extends Error {
  public readonly statusCode: number;
  public readonly isRetryable: boolean;

  constructor(message: string, statusCode = 500, isRetryable = false) {
    super(message);
    this.name = 'CalendarApiError';
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

export interface CalendarClientOptions {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  dbClient?: DbClient;
}

export interface GoogleCalendarEventPayload {
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
  conferenceData?: {
    createRequest?: {
      requestId: string;
      conferenceSolutionKey: {
        type: 'hangoutsMeet';
      };
    };
  };
}

export interface GoogleCalendarEventResult {
  id: string;
  etag?: string;
  hangoutLink?: string;
  htmlLink?: string;
  status?: string;
}

export interface GoogleCalendarItem {
  id: string;
  summary: string;
  primary?: boolean;
  description?: string;
}

export interface BusyTimeRange {
  start: string;
  end: string;
}

/**
 * Sanitizes a client / attendee name to "First Name + Last Initial" for PII minimization (Decision D6, AC-4).
 * Example: "Robert Schumann" -> "Robert S."
 */
export function sanitizeClientNameForCalendar(name?: string | null): string {
  if (!name || typeof name !== 'string') {
    return 'Client';
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return 'Client';
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0] ?? 'Client';
  }

  const firstName = parts[0] ?? 'Client';
  const lastPart = parts[parts.length - 1] ?? '';
  const lastInitial = lastPart.charAt(0).toUpperCase();

  return `${firstName} ${lastInitial}.`;
}

/**
 * Formats external Google Calendar event summary with studio prefix and PII minimization (AC-4).
 * Format: `[Studio] - [Title]: [First Name] [Last Initial]`
 */
export function formatCalendarEventSummary(params: {
  studioName?: string | null;
  entityType: 'appointment' | 'shoot' | 'blocked_time';
  title: string;
  attendeeName?: string | null;
}): string {
  const rawStudio = params.studioName?.trim();
  const studio = rawStudio && rawStudio.length > 0 ? rawStudio : 'Ownlight';
  const sanitizedAttendee = params.attendeeName
    ? sanitizeClientNameForCalendar(params.attendeeName)
    : null;

  if (params.entityType === 'appointment') {
    // If title contains colon or attendee name, normalize to base title (e.g. "Consultation")
    let baseTitle = params.title.trim();
    if (baseTitle.includes(':')) {
      const [firstTitlePart] = baseTitle.split(':');
      baseTitle = (firstTitlePart ?? 'Consultation').trim();
    }
    if (!baseTitle) {
      baseTitle = 'Consultation';
    }

    if (sanitizedAttendee) {
      return `${studio} - ${baseTitle}: ${sanitizedAttendee}`;
    }
    return `${studio} - ${baseTitle}`;
  }

  if (params.entityType === 'shoot') {
    let cleanTitle = params.title.trim();
    if (sanitizedAttendee && !cleanTitle.includes(sanitizedAttendee)) {
      cleanTitle = `${cleanTitle}: ${sanitizedAttendee}`;
    }
    return `${studio} - Shoot: ${cleanTitle}`;
  }

  // Blocked time
  return `${studio} - Blocked: ${params.title.trim()}`;
}

/**
 * Google Calendar API Client with token refreshing and error handling.
 */
export class GoogleCalendarClient {
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly dbClient: DbClient;

  constructor(options: CalendarClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.dbClient = options.dbClient ?? defaultDb;
  }

  async getValidAccessToken(): Promise<string> {
    try {
      return await getValidGoogleAccessToken(GOOGLE_OAUTH_PURPOSE, {
        dbClient: this.dbClient,
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      if (err instanceof GoogleOAuthError) {
        throw new CalendarApiError(err.message, err.statusCode, err.isRetryable);
      }
      if (err instanceof CalendarApiError) {
        throw err;
      }
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new CalendarApiError(
        'Network error refreshing Google access token.',
        isTimeout ? 408 : 502,
        true,
      );
    }
  }

  /**
   * Inserts an event into the target Google Calendar.
   */
  async insertEvent(
    calendarId: string,
    event: GoogleCalendarEventPayload,
    options: { conferenceDataVersion?: number } = {},
  ): Promise<GoogleCalendarEventResult> {
    const accessToken = await this.getValidAccessToken();
    const query =
      options.conferenceDataVersion !== undefined
        ? `?conferenceDataVersion=${String(options.conferenceDataVersion)}`
        : '';
    const url = `${getGoogleCalendarApiBase()}/calendars/${encodeURIComponent(calendarId)}/events${query}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn({ isTimeout }, 'Network failure calling Google Calendar insertEvent');
      throw new CalendarApiError(
        'Network error inserting Google Calendar event.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (!response.ok) {
      const isRetryable = response.status === 429 || response.status >= 500;
      logger.warn({ status: response.status }, 'Google Calendar insertEvent failed');
      throw new CalendarApiError(
        `Google Calendar insertEvent failed: HTTP ${String(response.status)}`,
        response.status,
        isRetryable,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const id = typeof data.id === 'string' ? data.id : '';
    const etag = typeof data.etag === 'string' ? data.etag : undefined;
    const htmlLink = typeof data.htmlLink === 'string' ? data.htmlLink : undefined;
    const status = typeof data.status === 'string' ? data.status : undefined;

    // Extract Google Meet video conference link if returned (AC-2)
    let hangoutLink = typeof data.hangoutLink === 'string' ? data.hangoutLink : undefined;
    if (!hangoutLink && typeof data.conferenceData === 'object' && data.conferenceData) {
      const conf = data.conferenceData as {
        entryPoints?: { entryPointType: string; uri: string }[];
      };
      const videoEntry = conf.entryPoints?.find((ep) => ep.entryPointType === 'video');
      if (videoEntry?.uri) {
        hangoutLink = videoEntry.uri;
      }
    }

    return {
      id,
      etag,
      hangoutLink,
      htmlLink,
      status,
    };
  }

  /**
   * Updates an existing Google Calendar event.
   */
  async updateEvent(
    calendarId: string,
    eventId: string,
    event: GoogleCalendarEventPayload,
    options: { conferenceDataVersion?: number } = {},
  ): Promise<GoogleCalendarEventResult> {
    const accessToken = await this.getValidAccessToken();
    const query =
      options.conferenceDataVersion !== undefined
        ? `?conferenceDataVersion=${String(options.conferenceDataVersion)}`
        : '';
    const url = `${getGoogleCalendarApiBase()}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}${query}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn({ isTimeout }, 'Network failure calling Google Calendar updateEvent');
      throw new CalendarApiError(
        'Network error updating Google Calendar event.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (!response.ok) {
      const isRetryable = response.status === 429 || response.status >= 500;
      logger.warn({ status: response.status }, 'Google Calendar updateEvent failed');
      throw new CalendarApiError(
        `Google Calendar updateEvent failed: HTTP ${String(response.status)}`,
        response.status,
        isRetryable,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;
    const id = typeof data.id === 'string' ? data.id : eventId;
    const etag = typeof data.etag === 'string' ? data.etag : undefined;
    const htmlLink = typeof data.htmlLink === 'string' ? data.htmlLink : undefined;
    const status = typeof data.status === 'string' ? data.status : undefined;

    let hangoutLink = typeof data.hangoutLink === 'string' ? data.hangoutLink : undefined;
    if (!hangoutLink && typeof data.conferenceData === 'object' && data.conferenceData) {
      const conf = data.conferenceData as {
        entryPoints?: { entryPointType: string; uri: string }[];
      };
      const videoEntry = conf.entryPoints?.find((ep) => ep.entryPointType === 'video');
      if (videoEntry?.uri) {
        hangoutLink = videoEntry.uri;
      }
    }

    return {
      id,
      etag,
      hangoutLink,
      htmlLink,
      status,
    };
  }

  /**
   * Deletes an event from Google Calendar.
   * Treats 404/410 as success (idempotent delete).
   */
  async deleteEvent(calendarId: string, eventId: string): Promise<boolean> {
    const accessToken = await this.getValidAccessToken();
    const url = `${getGoogleCalendarApiBase()}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn({ isTimeout }, 'Network failure calling Google Calendar deleteEvent');
      throw new CalendarApiError(
        'Network error deleting Google Calendar event.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (response.status === 404 || response.status === 410) {
      return true;
    }

    if (!response.ok) {
      const isRetryable = response.status === 429 || response.status >= 500;
      logger.warn({ status: response.status }, 'Google Calendar deleteEvent failed');
      throw new CalendarApiError(
        `Google Calendar deleteEvent failed: HTTP ${String(response.status)}`,
        response.status,
        isRetryable,
      );
    }

    return true;
  }

  /**
   * Queries free/busy information for the specified calendar and rolling time range (AC-5).
   */
  async queryFreeBusy(
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ): Promise<BusyTimeRange[]> {
    const accessToken = await this.getValidAccessToken();
    const url = `${getGoogleCalendarApiBase()}/freeBusy`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: [{ id: calendarId }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn({ isTimeout }, 'Network failure querying Google Calendar freeBusy');
      throw new CalendarApiError(
        'Network error querying Google Calendar freeBusy.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (!response.ok) {
      const isRetryable = response.status === 429 || response.status >= 500;
      logger.warn({ status: response.status }, 'Google Calendar freeBusy query failed');
      throw new CalendarApiError(
        `Google Calendar freeBusy query failed: HTTP ${String(response.status)}`,
        response.status,
        isRetryable,
      );
    }

    const data = (await response.json()) as {
      calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
    };

    const calendarData = data.calendars?.[calendarId] ?? Object.values(data.calendars ?? {})[0];
    const busyList = calendarData?.busy ?? [];

    return busyList
      .filter((b) => typeof b.start === 'string' && typeof b.end === 'string')
      .map((b) => ({
        start: b.start,
        end: b.end,
      }));
  }

  /**
   * Lists calendars available to the user (primary and secondary).
   */
  async listCalendars(): Promise<GoogleCalendarItem[]> {
    const accessToken = await this.getValidAccessToken();
    const url = `${getGoogleCalendarApiBase()}/users/me/calendarList`;

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
      logger.warn({ isTimeout }, 'Network failure listing Google calendars');
      throw new CalendarApiError(
        'Network error listing Google calendars.',
        isTimeout ? 408 : 502,
        true,
      );
    }

    if (!response.ok) {
      const isRetryable = response.status === 429 || response.status >= 500;
      logger.warn({ status: response.status }, 'Google Calendar list failed');
      throw new CalendarApiError(
        `Google Calendar list failed: HTTP ${String(response.status)}`,
        response.status,
        isRetryable,
      );
    }

    const data = (await response.json()) as {
      items?: { id?: string; summary?: string; primary?: boolean; description?: string }[];
    };

    return (data.items ?? [])
      .filter(
        (item): item is typeof item & { id: string } =>
          typeof item.id === 'string' && item.id.length > 0,
      )
      .map((item) => ({
        id: item.id,
        summary: item.summary ?? item.id,
        primary: Boolean(item.primary),
        description: item.description,
      }));
  }
}
