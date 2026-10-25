import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-2: Multi-Stage Hardened Dockerfile', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const dockerfilePath = path.resolve(rootDir, 'Dockerfile');

  it('AC-2: Dockerfile exists and uses pinned Node 24 alpine base image', () => {
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    // Base image should be pinned Node 24 alpine
    expect(content.includes('FROM node:24.2.0-alpine3.21')).toBe(true);
  });

  it('AC-2: implements multi-stage build with deps, builder, and runner stages', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    expect(content).toMatch(/FROM\s+node:24\.2\.0-alpine3\.21\s+AS\s+deps/i);
    expect(content).toMatch(/FROM\s+node:24\.2\.0-alpine3\.21\s+AS\s+builder/i);
    expect(content).toMatch(/FROM\s+node:24\.2\.0-alpine3\.21\s+AS\s+runner/i);
  });

  it('AC-2: creates and switches to dedicated unprivileged nodejs user (UID 1001, GID 1001)', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    expect(
      content.includes('addgroup') && content.includes('1001') && content.includes('nodejs'),
    ).toBe(true);
    expect(
      content.includes('adduser') && content.includes('1001') && content.includes('nodejs'),
    ).toBe(true);
    expect(content).toMatch(/USER\s+nodejs/);
  });

  it('AC-2: copies standalone server, static assets, public directory, migrations, and worker bundle', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    expect(content).toMatch(/COPY.*\.next\/standalone/);
    expect(content).toMatch(/COPY.*\.next\/static/);
    expect(content).toMatch(/COPY.*public/);
    expect(content).toMatch(/COPY.*scripts\/migrate\.mjs/);
    expect(content).toMatch(/COPY.*drizzle/);
    expect(content).toMatch(/COPY.*scripts\/worker\.mjs/);
    expect(content).toMatch(/COPY.*dist\/retention/);
  });

  it('AC-2: exposes port 3000, sets production environment, and configures /api/health healthcheck', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8');

    expect(content).toMatch(/EXPOSE\s+3000/);
    expect(content).toMatch(/ENV\s+NODE_ENV(=|\s+)production/);
    expect(content).toMatch(/ENV\s+PORT(=|\s+)3000/);
    expect(content).toMatch(/ENV\s+HOSTNAME(=|\s+)["']?0\.0\.0\.0["']?/);
    expect(content).toMatch(/HEALTHCHECK[\s\S]*http:\/\/127\.0\.0\.1:3000\/api\/health/);
  });
});
