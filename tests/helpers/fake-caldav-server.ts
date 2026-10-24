import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface RecordedCaldavRequest {
  url: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface FakeCaldavServerInstance {
  server: http.Server;
  baseUrl: string;
  events: Map<string, { url: string; icalString: string; etag: string }>;
  requests: RecordedCaldavRequest[];
  authRequired: boolean;
  expectedUser?: string;
  expectedPass?: string;
  busyEvents: string[]; // iCal VEVENT strings to return in calendar-query/fetchObjects
  close: () => Promise<void>;
  reset: () => void;
}

/**
 * Creates an in-memory RFC 4791 CalDAV fake HTTP server for integration testing.
 */
export async function createFakeCaldavServer(
  options: {
    authRequired?: boolean;
    expectedUser?: string;
    expectedPass?: string;
  } = {},
): Promise<FakeCaldavServerInstance> {
  const events = new Map<string, { url: string; icalString: string; etag: string }>();
  const requests: RecordedCaldavRequest[] = [];
  let etagCounter = 100;

  const instance: FakeCaldavServerInstance = {
    server: null as unknown as http.Server,
    baseUrl: '',
    events,
    requests,
    authRequired: options.authRequired ?? true,
    expectedUser: options.expectedUser ?? 'photographer@example.org',
    expectedPass: options.expectedPass ?? 'app-specific-secret',
    busyEvents: [],
    close: () => Promise.resolve(),
    reset: () => {
      events.clear();
      requests.length = 0;
      instance.busyEvents = [];
    },
  };

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk: Buffer | string) => {
      rawBody += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    req.on('end', () => {
      const recorded: RecordedCaldavRequest = {
        url: req.url ?? '/',
        method: req.method ?? 'GET',
        headers: req.headers,
        body: rawBody,
      };
      requests.push(recorded);

      // 1. Basic Auth check if enabled
      if (instance.authRequired) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Basic ')) {
          res.writeHead(401, {
            'WWW-Authenticate': 'Basic realm="CalDAV"',
            'Content-Type': 'text/plain',
          });
          res.end('Unauthorized');
          return;
        }

        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const [user, pass] = credentials.split(':');
        if (user !== instance.expectedUser || pass !== instance.expectedPass) {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Invalid credentials');
          return;
        }
      }

      const method = (req.method ?? 'GET').toUpperCase();
      const urlObj = new URL(req.url ?? '/', 'http://localhost');
      const pathname = urlObj.pathname;

      // 2. PROPFIND Discovery
      if (method === 'PROPFIND') {
        res.writeHead(207, {
          'Content-Type': 'application/xml; charset=utf-8',
          DAV: '1, 3, calendar-access',
        });

        // A. Root or Server URL: return current-user-principal
        if (pathname === '/' || pathname === '/dav/' || pathname === '/dav') {
          res.end(`<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${pathname.endsWith('/') ? pathname : `${pathname}/`}</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal>
          <D:href>/principals/users/owner/</D:href>
        </D:current-user-principal>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);
          return;
        }

        // B. Principal URL: return calendar-home-set
        if (pathname.includes('/principals/')) {
          res.end(`<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/principals/users/owner/</D:href>
    <D:propstat>
      <D:prop>
        <C:calendar-home-set>
          <D:href>/calendars/owner/</D:href>
        </C:calendar-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);
          return;
        }

        // C. Calendar Home Set: list user calendars
        if (pathname === '/calendars/owner/' || pathname === '/calendars/owner') {
          res.end(`<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/calendars/owner/personal/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype>
          <D:collection/>
          <C:calendar/>
        </D:resourcetype>
        <D:displayname>Personal</D:displayname>
        <CS:getctag>"ctag-personal-1"</CS:getctag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/calendars/owner/work/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype>
          <D:collection/>
          <C:calendar/>
        </D:resourcetype>
        <D:displayname>Studio Work</D:displayname>
        <CS:getctag>"ctag-work-1"</CS:getctag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);
          return;
        }

        // D. Specific Calendar collection info
        res.end(`<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>${pathname}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>Studio Work</D:displayname>
        <CS:getctag>"ctag-work-1"</CS:getctag>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);
        return;
      }

      // 3. REPORT calendar-query / fetchCalendarObjects
      if (method === 'REPORT') {
        res.writeHead(207, {
          'Content-Type': 'application/xml; charset=utf-8',
          DAV: '1, 3, calendar-access',
        });

        // Build responses for stored events + busyEvents
        const responseBlocks: string[] = [];

        // Stored outbound events
        for (const [url, item] of events.entries()) {
          responseBlocks.push(`
  <D:response>
    <D:href>${url}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${item.etag}</D:getetag>
        <C:calendar-data><![CDATA[${item.icalString}]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`);
        }

        // Extra busy events for testing inbound sync
        for (let idx = 0; idx < instance.busyEvents.length; idx++) {
          const icalData = instance.busyEvents[idx] ?? '';
          responseBlocks.push(`
  <D:response>
    <D:href>${pathname}busy-${String(idx + 1)}.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"busy-etag-${String(idx + 1)}"</D:getetag>
        <C:calendar-data><![CDATA[${icalData}]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`);
        }

        res.end(`<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  ${responseBlocks.join('\n')}
</D:multistatus>`);
        return;
      }

      // 4. PUT create/update calendar object
      if (method === 'PUT') {
        etagCounter += 1;
        const newEtag = `"etag-caldav-${String(etagCounter)}"`;
        const existing = events.get(pathname);
        events.set(pathname, {
          url: pathname,
          icalString: rawBody,
          etag: newEtag,
        });

        res.writeHead(existing ? 204 : 201, {
          ETag: newEtag,
          'Content-Type': 'text/plain',
        });
        res.end();
        return;
      }

      // 5. DELETE calendar object
      if (method === 'DELETE') {
        const deleted = events.delete(pathname);
        res.writeHead(deleted ? 204 : 404);
        res.end();
        return;
      }

      // Fallback
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${method} ${pathname}`);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const addr = server.address() as AddressInfo;
  instance.baseUrl = `http://127.0.0.1:${String(addr.port)}`;
  instance.server = server;
  instance.close = async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return instance;
}
