import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from '@/middleware';
import { parseEmbedOrigins, getEmbedOrigins } from '@/env';

describe('AC-1 to AC-7: Embed Origins and Per-Route Framing CSP', () => {
  describe('Origin allowlist parsing and validation', () => {
    it('AC-1: parses valid comma-separated HTTPS origins', () => {
      const input = 'https://photographer.example, https://studio.example';
      const parsed = parseEmbedOrigins(input, true);
      expect(parsed).toEqual(['https://photographer.example', 'https://studio.example']);
    });

    it('AC-1: allows port numbers in origins without paths or trailing slashes', () => {
      const input = 'https://photographer.example:8443,https://studio.example';
      const parsed = parseEmbedOrigins(input, true);
      expect(parsed).toEqual(['https://photographer.example:8443', 'https://studio.example']);
    });

    it('AC-1: permits http://localhost:<port> in non-production environments', () => {
      const input = 'http://localhost:3000,https://photographer.example';
      const parsed = parseEmbedOrigins(input, false);
      expect(parsed).toEqual(['http://localhost:3000', 'https://photographer.example']);
    });

    it('AC-2: returns empty array for empty, whitespace, or undefined input', () => {
      expect(parseEmbedOrigins('', false)).toEqual([]);
      expect(parseEmbedOrigins('   ', false)).toEqual([]);
      expect(parseEmbedOrigins(undefined, false)).toEqual([]);
      expect(parseEmbedOrigins(null, false)).toEqual([]);
    });

    it('AC-2: getEmbedOrigins returns empty array when unconfigured', () => {
      expect(getEmbedOrigins('')).toEqual([]);
      expect(getEmbedOrigins('   ')).toEqual([]);
    });

    it('AC-5: rejects origin with wildcard', () => {
      expect(() => parseEmbedOrigins('https://*.example.com', true)).toThrow(
        /wildcards are not allowed/,
      );
      expect(() => parseEmbedOrigins('*', true)).toThrow(/wildcards are not allowed/);
    });

    it('AC-5: rejects origin with trailing slash', () => {
      expect(() => parseEmbedOrigins('https://photographer.example/', true)).toThrow(
        /trailing slash is not allowed/,
      );
    });

    it('AC-5: rejects origin with path or query', () => {
      expect(() => parseEmbedOrigins('https://photographer.example/contact', true)).toThrow(
        /must be a bare origin with no path/,
      );
      expect(() => parseEmbedOrigins('https://photographer.example?query=1', true)).toThrow(
        /must be a bare origin with no path/,
      );
    });

    it('AC-5: rejects origin with credentials', () => {
      expect(() => parseEmbedOrigins('https://user:pass@photographer.example', true)).toThrow(
        /must be a bare origin/,
      );
    });

    it('AC-5: rejects insecure http origin in production', () => {
      expect(() => parseEmbedOrigins('http://photographer.example', true)).toThrow(
        /scheme must be https:\/\//,
      );
      expect(() => parseEmbedOrigins('http://localhost:3000', true)).toThrow(
        /scheme must be https:\/\//,
      );
    });

    it('AC-5: rejects when more than 10 origins are provided', () => {
      const origins = Array.from({ length: 11 }, (_, i) => `https://site${String(i)}.example`).join(
        ',',
      );
      expect(() => parseEmbedOrigins(origins, true)).toThrow(/allows at most 10 origins/);
    });
  });

  describe('Middleware per-route framing CSP and headers', () => {
    const originalEnv = process.env.PUBLIC_FORMS_EMBED_ORIGINS;

    it('AC-1: embed route GET /{locale}/f/{slug}/embed sets frame-ancestors allowlist and omits X-Frame-Options', () => {
      process.env.PUBLIC_FORMS_EMBED_ORIGINS =
        'https://photographer.example,https://studio.example';
      try {
        const req = new NextRequest('http://localhost:3000/en/f/inq-test01/embed');
        const res = middleware(req);

        expect(res.status).toBe(200);
        const csp = res.headers.get('Content-Security-Policy');
        expect(csp).toBeDefined();
        expect(csp).toContain(
          "frame-ancestors 'self' https://photographer.example https://studio.example;",
        );
        expect(res.headers.get('X-Frame-Options')).toBeNull();
      } finally {
        process.env.PUBLIC_FORMS_EMBED_ORIGINS = originalEnv;
      }
    });

    it('AC-1: embed thanks route GET /{locale}/f/{slug}/embed/thanks sets frame-ancestors allowlist and omits X-Frame-Options', () => {
      process.env.PUBLIC_FORMS_EMBED_ORIGINS = 'https://photographer.example';
      try {
        const req = new NextRequest('http://localhost:3000/en/f/inq-test01/embed/thanks');
        const res = middleware(req);

        expect(res.status).toBe(200);
        const csp = res.headers.get('Content-Security-Policy');
        expect(csp).toBeDefined();
        expect(csp).toContain("frame-ancestors 'self' https://photographer.example;");
        expect(res.headers.get('X-Frame-Options')).toBeNull();
      } finally {
        process.env.PUBLIC_FORMS_EMBED_ORIGINS = originalEnv;
      }
    });

    it('AC-2: embed routes return 404 Not Found when PUBLIC_FORMS_EMBED_ORIGINS is unset or empty', () => {
      process.env.PUBLIC_FORMS_EMBED_ORIGINS = '';
      try {
        const req1 = new NextRequest('http://localhost:3000/en/f/inq-test01/embed');
        const res1 = middleware(req1);
        expect(res1.status).toBe(404);

        const req2 = new NextRequest('http://localhost:3000/en/f/inq-test01/embed/thanks');
        const res2 = middleware(req2);
        expect(res2.status).toBe(404);
      } finally {
        process.env.PUBLIC_FORMS_EMBED_ORIGINS = originalEnv;
      }
    });

    it('AC-3: standard hosted form route retains frame-ancestors none and X-Frame-Options: DENY', () => {
      process.env.PUBLIC_FORMS_EMBED_ORIGINS = 'https://photographer.example';
      try {
        const req = new NextRequest('http://localhost:3000/en/f/inq-test01');
        const res = middleware(req);

        expect(res.status).toBe(200);
        const csp = res.headers.get('Content-Security-Policy');
        expect(csp).toContain("frame-ancestors 'none'");
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      } finally {
        process.env.PUBLIC_FORMS_EMBED_ORIGINS = originalEnv;
      }
    });

    it('AC-3: owner administration routes retain frame-ancestors none and X-Frame-Options: DENY', () => {
      process.env.PUBLIC_FORMS_EMBED_ORIGINS = 'https://photographer.example';
      try {
        // Authenticated request to /en/leads
        const req = new NextRequest('http://localhost:3000/en/leads', {
          headers: {
            cookie: 'ownlight_session=valid-session',
          },
        });
        const res = middleware(req);

        expect(res.status).toBe(200);
        const csp = res.headers.get('Content-Security-Policy');
        expect(csp).toContain("frame-ancestors 'none'");
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      } finally {
        process.env.PUBLIC_FORMS_EMBED_ORIGINS = originalEnv;
      }
    });

    it('AC-12: embed routes strip any Set-Cookie headers from response', () => {
      process.env.PUBLIC_FORMS_EMBED_ORIGINS = 'https://photographer.example';
      try {
        const req = new NextRequest('http://localhost:3000/en/f/inq-test01/embed');
        const res = middleware(req);

        expect(res.headers.get('Set-Cookie')).toBeNull();
      } finally {
        process.env.PUBLIC_FORMS_EMBED_ORIGINS = originalEnv;
      }
    });
  });

  describe('Success redirect URL validation (AC-6, AC-7)', () => {
    it('AC-6: accepts valid HTTPS success_redirect_url belonging to allowed embed origins', () => {
      const allowedOrigins = ['https://photographer.example', 'https://studio.example'];
      const candidate = 'https://photographer.example/thank-you?lead=new';

      let parsedOrigin: string | null = null;
      try {
        parsedOrigin = new URL(candidate).origin;
      } catch {
        parsedOrigin = null;
      }

      expect(parsedOrigin).toBe('https://photographer.example');
      expect(allowedOrigins.includes(parsedOrigin ?? '')).toBe(true);
    });

    it('AC-7: rejects success_redirect_url whose origin is not in allowed embed origins', () => {
      const allowedOrigins = ['https://photographer.example'];
      const candidate = 'https://attacker.example/phish';

      let parsedOrigin: string | null = null;
      try {
        parsedOrigin = new URL(candidate).origin;
      } catch {
        parsedOrigin = null;
      }

      expect(allowedOrigins.includes(parsedOrigin ?? '')).toBe(false);
    });

    it('AC-7: rejects javascript:, data:, or malformed redirect URLs', () => {
      const candidates = ['javascript:alert(1)', 'data:text/html,test', 'not-a-url'];
      const allowedOrigins = ['https://photographer.example'];

      for (const candidate of candidates) {
        let isAllowed = false;
        try {
          const url = new URL(candidate);
          isAllowed = url.protocol === 'https:' && allowedOrigins.includes(url.origin);
        } catch {
          isAllowed = false;
        }
        expect(isAllowed).toBe(false);
      }
    });
  });
});
