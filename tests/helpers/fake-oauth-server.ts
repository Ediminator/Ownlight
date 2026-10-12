import http from 'node:http';
import { AddressInfo } from 'node:net';

export interface FakeOAuthServerOptions {
  tokenStatus?: number;
  tokenResponse?: Record<string, unknown>;
  revokeStatus?: number;
}

export interface FakeOAuthServerInstance {
  server: http.Server;
  baseUrl: string;
  authUrl: string;
  tokenUrl: string;
  revokeUrl: string;
  requests: { url: string; method: string; body: string }[];
  close: () => Promise<void>;
  setTokenResponse: (status: number, response: Record<string, unknown>) => void;
  setRevokeResponse: (status: number) => void;
}

/**
 * Creates a hermetic local fake OAuth 2.0 HTTP server for integration testing.
 */
export async function createFakeOAuthServer(
  options: FakeOAuthServerOptions = {},
): Promise<FakeOAuthServerInstance> {
  const requests: { url: string; method: string; body: string }[] = [];

  let tokenStatus = options.tokenStatus ?? 200;
  let tokenResponse: Record<string, unknown> = options.tokenResponse ?? {
    access_token: `fake-access-token-12345`,
    refresh_token: `fake-refresh-token-secret-67890`,
    expires_in: 3600,
    scope: 'https://www.googleapis.com/auth/contacts',
    token_type: 'Bearer',
  };

  let revokeStatus = options.revokeStatus ?? 200;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer | string) => {
      body += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });

    req.on('end', () => {
      const reqUrl = req.url ?? '/';
      const reqMethod = req.method ?? 'GET';
      requests.push({
        url: reqUrl,
        method: reqMethod,
        body,
      });

      const parsedUrl = new URL(reqUrl, 'http://127.0.0.1');

      if (parsedUrl.pathname.endsWith('/token') && req.method === 'POST') {
        res.writeHead(tokenStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tokenResponse));
        return;
      }

      if (parsedUrl.pathname.endsWith('/revoke') && req.method === 'POST') {
        res.writeHead(revokeStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'revoked' }));
        return;
      }

      // Default
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;

  return {
    server,
    baseUrl,
    authUrl: `${baseUrl}/o/oauth2/v2/auth`,
    tokenUrl: `${baseUrl}/token`,
    revokeUrl: `${baseUrl}/revoke`,
    requests,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    setTokenResponse: (status, resp) => {
      tokenStatus = status;
      tokenResponse = resp;
    },
    setRevokeResponse: (status) => {
      revokeStatus = status;
    },
  };
}
