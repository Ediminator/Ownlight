import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface RecordedPeopleRequest {
  url: string;
  method: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  parsedBody?: Record<string, unknown>;
}

export interface FakeStoredContact {
  resourceName: string;
  etag: string;
  names: { givenName?: string; familyName?: string }[];
  phoneNumbers?: { value: string; type: string }[];
}

export interface FakePeopleServerInstance {
  server: http.Server;
  baseUrl: string;
  contacts: Map<string, FakeStoredContact>;
  requests: RecordedPeopleRequest[];
  close: () => Promise<void>;
  setResponseOverride: (
    method: string,
    pathSubstring: string,
    status: number,
    body?: unknown,
  ) => void;
  clearResponseOverrides: () => void;
  setNetworkDelayMs: (ms: number) => void;
  reset: () => void;
}

interface ResponseOverride {
  method: string;
  pathSubstring: string;
  status: number;
  body?: unknown;
}

/**
 * Creates a hermetic local fake Google People API v1 HTTP server for testing.
 */
export async function createFakePeopleServer(): Promise<FakePeopleServerInstance> {
  const contacts = new Map<string, FakeStoredContact>();
  const requests: RecordedPeopleRequest[] = [];
  let responseOverrides: ResponseOverride[] = [];
  let networkDelayMs = 0;
  let counter = 1000;

  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk: Buffer | string) => {
      rawBody += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    req.on('end', () => {
      const execute = () => {
        const reqUrl = req.url ?? '/';
        const reqMethod = req.method ?? 'GET';

        let parsedBody: Record<string, unknown> | undefined;
        if (rawBody.trim().length > 0) {
          try {
            parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
          } catch {
            // Leave undefined if non-JSON
          }
        }

        requests.push({
          url: reqUrl,
          method: reqMethod,
          headers: req.headers,
          body: rawBody,
          parsedBody,
        });

        // Check overrides
        const override = responseOverrides.find(
          (o) => o.method === reqMethod && reqUrl.includes(o.pathSubstring),
        );
        if (override) {
          res.writeHead(override.status, { 'Content-Type': 'application/json' });
          res.end(
            typeof override.body === 'string' ? override.body : JSON.stringify(override.body ?? {}),
          );
          return;
        }

        const parsedUrl = new URL(reqUrl, 'http://127.0.0.1');
        const pathname = parsedUrl.pathname;

        // 1. POST /v1/people:createContact
        if (pathname.endsWith('/people:createContact') && reqMethod === 'POST') {
          counter += 1;
          const resourceName = `people/c${String(counter)}`;
          const etag = `%${String(counter)}ETAGv1=`;

          const names = Array.isArray(parsedBody?.names)
            ? (parsedBody.names as { givenName?: string; familyName?: string }[])
            : [];
          const phoneNumbers = Array.isArray(parsedBody?.phoneNumbers)
            ? (parsedBody.phoneNumbers as { value: string; type: string }[])
            : undefined;

          const stored: FakeStoredContact = {
            resourceName,
            etag,
            names,
            phoneNumbers,
          };
          contacts.set(resourceName, stored);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(stored));
          return;
        }

        // 2. PATCH /v1/people/{id}:updateContact
        if (
          pathname.includes('/people/') &&
          pathname.includes(':updateContact') &&
          reqMethod === 'PATCH'
        ) {
          // Extract resourceName e.g. people/c1001 from /v1/people/c1001:updateContact
          const match = /(people\/[^:]+):updateContact/.exec(pathname);
          const resourceName = match ? match[1] : undefined;

          if (!resourceName || !contacts.has(resourceName)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 404, message: 'Person not found' } }));
            return;
          }

          const existing = contacts.get(resourceName);
          if (!existing) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 404, message: 'Person not found' } }));
            return;
          }
          counter += 1;
          const newEtag = `%${String(counter)}ETAGv${String(counter)}=`;

          const names = Array.isArray(parsedBody?.names)
            ? (parsedBody.names as { givenName?: string; familyName?: string }[])
            : existing.names;
          const phoneNumbers = Array.isArray(parsedBody?.phoneNumbers)
            ? (parsedBody.phoneNumbers as { value: string; type: string }[])
            : existing.phoneNumbers;

          const updated: FakeStoredContact = {
            resourceName,
            etag: newEtag,
            names,
            phoneNumbers,
          };
          contacts.set(resourceName, updated);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(updated));
          return;
        }

        // 3. DELETE /v1/people/{id}:deleteContact
        if (
          pathname.includes('/people/') &&
          pathname.includes(':deleteContact') &&
          reqMethod === 'DELETE'
        ) {
          const match = /(people\/[^:]+):deleteContact/.exec(pathname);
          const resourceName = match ? match[1] : undefined;

          if (resourceName) {
            contacts.delete(resourceName);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({}));
          return;
        }

        // Default 404
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 404, message: `Not Found: ${pathname}` } }));
      };

      if (networkDelayMs > 0) {
        setTimeout(execute, networkDelayMs);
      } else {
        execute();
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(address.port)}/v1`;

  return {
    server,
    baseUrl,
    contacts,
    requests,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
    setResponseOverride: (method, pathSubstring, status, body) => {
      responseOverrides.unshift({ method, pathSubstring, status, body });
    },
    clearResponseOverrides: () => {
      responseOverrides = [];
    },
    setNetworkDelayMs: (ms) => {
      networkDelayMs = ms;
    },
    reset: () => {
      contacts.clear();
      requests.length = 0;
      responseOverrides = [];
      networkDelayMs = 0;
    },
  };
}
