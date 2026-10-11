import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { POST } from '@/app/api/privacy/exports/route';
import { NextRequest } from 'next/server';
import * as authGuards from '@/server/auth/guards';
import * as reauthModule from '@/server/auth/reauth';
import * as exportService from '@/server/privacy/export/service';
import { UnauthorizedError, ForbiddenError, type AuthContext } from '@/server/auth/guards';

describe('TASK-0015: DSAR export route branches and edge cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const validOwnerAuth: AuthContext = {
    authType: 'session',
    scopes: ['*'],
    user: {
      id: '01912345-6789-7abc-8def-012345678000',
      email: 'owner@example.com',
      name: 'Studio Owner',
      role: 'owner',
      emailVerified: true,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: 's-1',
      userId: '01912345-6789-7abc-8def-012345678000',
      token: 'tok_test',
      expiresAt: new Date(Date.now() + 86400000),
      ipAddress: null,
      userAgent: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastReauthenticatedAt: new Date(),
    },
  };

  interface ApiErrorBody {
    message?: string;
    code?: string;
    error?: string;
  }

  it('rejects origin mismatch with 403 Forbidden', async () => {
    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: {
        origin: 'https://malicious-site.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ contactId: '01912345-6789-7abc-8def-012345678001' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.message).toBe('Forbidden origin');
  });

  it('allows origin matching host header and proceeds to auth check', async () => {
    vi.spyOn(authGuards, 'requireOwnerSession').mockRejectedValueOnce(
      new UnauthorizedError('Authentication required'),
    );

    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ contactId: '01912345-6789-7abc-8def-012345678001' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects bearer token / API key header with 403 Forbidden', async () => {
    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ow_test_api_key_123',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ contactId: '01912345-6789-7abc-8def-012345678001' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.message).toBe('API keys are not permitted for data exports');
  });

  it('returns 403 Forbidden when requireOwnerSession throws ForbiddenError', async () => {
    vi.spyOn(authGuards, 'requireOwnerSession').mockRejectedValueOnce(
      new ForbiddenError('Owner role required'),
    );

    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: '01912345-6789-7abc-8def-012345678001' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.message).toBe('Owner role required');
  });

  it('returns 401 Unauthorized when requireOwnerSession throws UnauthorizedError', async () => {
    vi.spyOn(authGuards, 'requireOwnerSession').mockRejectedValueOnce(
      new UnauthorizedError('Authentication required'),
    );

    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: '01912345-6789-7abc-8def-012345678001' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.message).toBe('Authentication required');
  });

  it('returns 403 Forbidden when authType is not session', async () => {
    vi.spyOn(authGuards, 'requireOwnerSession').mockResolvedValueOnce({
      authType: 'apiKey',
      scopes: ['*'],
      user: validOwnerAuth.user,
      apiKey: {
        id: 'k1',
        name: 'Key',
        prefix: 'ow_',
        tokenHash: 'h',
        scopes: ['*'],
        expiresAt: null,
        lastUsedAt: null,
        userId: validOwnerAuth.user.id,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as unknown as AuthContext);

    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: '01912345-6789-7abc-8def-012345678001' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.message).toBe('Web session required');
  });

  it('returns 403 REAUTH_REQUIRED when assertFreshReauthentication throws', async () => {
    vi.spyOn(authGuards, 'requireOwnerSession').mockResolvedValueOnce(validOwnerAuth);
    vi.spyOn(reauthModule, 'assertFreshReauthentication').mockRejectedValueOnce(
      new Error('REAUTH_REQUIRED'),
    );

    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: '01912345-6789-7abc-8def-012345678001' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.code).toBe('REAUTH_REQUIRED');
  });

  it('returns 400 BAD_REQUEST on invalid JSON payload', async () => {
    vi.spyOn(authGuards, 'requireOwnerSession').mockResolvedValueOnce(validOwnerAuth);
    vi.spyOn(reauthModule, 'assertFreshReauthentication').mockResolvedValueOnce();

    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'invalid-not-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.message).toBe('Invalid JSON payload');
  });

  it('returns 400 BAD_REQUEST when contactId is invalid UUID', async () => {
    vi.spyOn(authGuards, 'requireOwnerSession').mockResolvedValueOnce(validOwnerAuth);
    vi.spyOn(reauthModule, 'assertFreshReauthentication').mockResolvedValueOnce();

    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contactId: 'not-a-uuid', format: 'json', locale: 'en' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.code).toBe('BAD_REQUEST');
  });

  it('returns 404 NOT_FOUND when generateExport returns null', async () => {
    vi.spyOn(authGuards, 'requireOwnerSession').mockResolvedValueOnce(validOwnerAuth);
    vi.spyOn(reauthModule, 'assertFreshReauthentication').mockResolvedValueOnce();
    vi.spyOn(exportService, 'generateExport').mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/privacy/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contactId: '01912345-6789-7abc-8def-012345678001',
        format: 'json',
        locale: 'en',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiErrorBody;
    expect(body.code).toBe('NOT_FOUND');
  });
});
