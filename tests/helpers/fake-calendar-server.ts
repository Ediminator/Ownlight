import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface RecordedCalendarRequest {
  url: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  parsedBody?: Record<string, unknown>;
}

export interface FakeStoredEvent {
  id: string;
  calendarId: string;
  etag: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  hangoutLink?: string;
}

export interface FakeCalendarServerInstance {
  server: http.Server;
  baseUrl: string;
  events: Map<string, FakeStoredEvent>;
  busyRanges: { start: string; end: string }[];
  requests: RecordedCalendarRequest[];
  close: () => Promise<void>;
  setResponseOverride: (
    method: string,
    pathSubstring: string,
    status: number,
    body?: unknown,
  ) => void;
  clearResponseOverrides: () => void;
  reset: () => void;
}

interface ResponseOverride {
  method: string;
  pathSubstring: string;
  status: number;
  body?: unknown;
}

/**
 * Creates an in-memory local fake Google Calendar API v3 HTTP server for integration testing.
 */
export async function createFakeCalendarServer(): Promise<FakeCalendarServerInstance> {
  const events = new Map<string, FakeStoredEvent>();
  const requests: RecordedCalendarRequest[] = [];
  let responseOverrides: ResponseOverride[] = [];
  let counter = 5000;

  const instance: FakeCalendarServerInstance = {
    server: null as unknown as http.Server,
    baseUrl: '',
    events,
    busyRanges: [],
    requests,
    close: () => Promise.resolve(),
    setResponseOverride: (method, pathSubstring, status, body) => {
      responseOverrides.push({ method: method.toUpperCase(), pathSubstring, status, body });
    },
    clearResponseOverrides: () => {
      responseOverrides = [];
    },
    reset: () => {
      events.clear();
      instance.busyRanges = [];
      requests.length = 0;
      responseOverrides = [];
    },
  };

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk: Buffer | string) => {
      rawBody += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    req.on('end', () => {
      const parsedBody = rawBody.trim().startsWith('{')
        ? (JSON.parse(rawBody) as Record<string, unknown>)
        : undefined;

      const recordedReq: RecordedCalendarRequest = {
        url: req.url ?? '/',
        method: req.method ?? 'GET',
        headers: req.headers,
        body: rawBody,
        parsedBody,
      };
      requests.push(recordedReq);

      const urlObj = new URL(req.url ?? '/', 'http://localhost');
      const pathname = urlObj.pathname;
      const method = (req.method ?? 'GET').toUpperCase();

      // Check overrides
      const override = responseOverrides.find(
        (o) =>
          o.method === method &&
          (pathname.includes(o.pathSubstring) || (req.url?.includes(o.pathSubstring) ?? false)),
      );

      if (override) {
        res.writeHead(override.status, { 'Content-Type': 'application/json' });
        if (override.body !== undefined) {
          res.end(
            typeof override.body === 'string' ? override.body : JSON.stringify(override.body),
          );
        } else {
          res.end();
        }
        return;
      }

      // 1. Calendar list
      if (method === 'GET' && pathname === '/users/me/calendarList') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            kind: 'calendar#calendarList',
            items: [
              { id: 'primary', summary: 'Primary Calendar', primary: true },
              { id: 'secondary_cal_1', summary: 'Studio Portraits', primary: false },
            ],
          }),
        );
        return;
      }

      // 2. Free/busy query
      if (method === 'POST' && pathname === '/freeBusy') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            kind: 'calendar#freeBusy',
            calendars: {
              primary: {
                busy: instance.busyRanges,
              },
            },
          }),
        );
        return;
      }

      // 3. Create event: POST /calendars/:calendarId/events
      const createMatch = /^\/calendars\/([^/]+)\/events$/.exec(pathname);
      if (method === 'POST' && createMatch?.[1]) {
        const calendarId = decodeURIComponent(createMatch[1]);
        counter += 1;
        const counterStr = String(counter);
        const eventId = `g_evt_${counterStr}`;
        const hasMeetRequest =
          typeof parsedBody?.conferenceData === 'object' &&
          parsedBody.conferenceData !== null &&
          'createRequest' in (parsedBody.conferenceData as Record<string, unknown>);

        const hangoutLink = hasMeetRequest
          ? `https://meet.google.com/xyz-fake-${counterStr}`
          : undefined;

        const summaryStr =
          typeof parsedBody?.summary === 'string' ? parsedBody.summary : 'Untitled Event';
        const descStr =
          typeof parsedBody?.description === 'string' ? parsedBody.description : undefined;

        const stored: FakeStoredEvent = {
          id: eventId,
          calendarId,
          etag: `"etag_${counterStr}"`,
          summary: summaryStr,
          description: descStr,
          start: (parsedBody?.start as { dateTime?: string; date?: string } | undefined) ?? {},
          end: (parsedBody?.end as { dateTime?: string; date?: string } | undefined) ?? {},
          hangoutLink,
        };
        events.set(eventId, stored);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: eventId,
            etag: stored.etag,
            summary: stored.summary,
            description: stored.description,
            hangoutLink,
            htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
            status: 'confirmed',
          }),
        );
        return;
      }

      // 4. Update event: PUT or PATCH /calendars/:calendarId/events/:eventId
      const patchMatch = /^\/calendars\/([^/]+)\/events\/([^/]+)$/.exec(pathname);
      if ((method === 'PATCH' || method === 'PUT') && patchMatch?.[1] && patchMatch[2]) {
        const calId = decodeURIComponent(patchMatch[1]);
        const eventId = decodeURIComponent(patchMatch[2]);
        const existing = events.get(eventId) ?? {
          id: eventId,
          calendarId: calId,
          etag: '"etag_initial"',
          summary: 'Existing',
          start: {},
          end: {},
        };

        counter += 1;
        const counterStr = String(counter);
        existing.etag = `"etag_${counterStr}"`;
        if (typeof parsedBody?.summary === 'string') {
          existing.summary = parsedBody.summary;
        }
        events.set(eventId, existing);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: eventId,
            etag: existing.etag,
            summary: existing.summary,
            hangoutLink: existing.hangoutLink,
            htmlLink: `https://calendar.google.com/event?eid=${eventId}`,
            status: 'confirmed',
          }),
        );
        return;
      }

      // 5. Delete event: DELETE /calendars/:calendarId/events/:eventId
      if (method === 'DELETE' && patchMatch?.[2]) {
        const eventId = decodeURIComponent(patchMatch[2]);
        events.delete(eventId);
        res.writeHead(204);
        res.end();
        return;
      }

      // Fallback
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Not found: ${method} ${pathname}` } }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(addr.port)}`;

  instance.server = server;
  instance.baseUrl = baseUrl;
  instance.close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  };

  return instance;
}
