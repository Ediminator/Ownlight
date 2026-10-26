import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Dockerfile Configuration & Hardening (TASK-0052)', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const dockerfilePath = path.resolve(rootDir, 'Dockerfile');
  const content = fs.readFileSync(dockerfilePath, 'utf8');

  // Helper to extract stages
  const stages = content.split(/FROM\s+/i).slice(1);
  const depsStage = stages.find((s) => s.startsWith('node:24.2.0-alpine3.21 AS deps')) ?? '';
  const builderStage = stages.find((s) => s.startsWith('node:24.2.0-alpine3.21 AS builder')) ?? '';
  const runnerStage = stages.find((s) => s.startsWith('node:24.2.0-alpine3.21 AS runner')) ?? '';

  it('AC-1: deps and builder stages install pnpm directly via npm install -g pnpm@12.10.1 without Corepack', () => {
    expect(content.includes('corepack')).toBe(false);
    expect(depsStage).toMatch(/npm\s+install\s+-g\s+pnpm@12\.10\.1/);
    expect(builderStage).toMatch(/npm\s+install\s+-g\s+pnpm@12\.10\.1/);
  });

  it('AC-2: deps, builder, and runner stages each install libc6-compat for Alpine native binary compatibility', () => {
    expect(depsStage).toMatch(/apk\s+add\s+--no-cache\s+libc6-compat/);
    expect(builderStage).toMatch(/apk\s+add\s+--no-cache\s+libc6-compat/);
    expect(runnerStage).toMatch(/apk\s+add\s+--no-cache\s+libc6-compat/);
  });

  it('AC-3: maintains unprivileged nodejs user (UID 1001, GID 1001), healthcheck /api/health, and port 3000 exposure', () => {
    expect(
      runnerStage.includes('addgroup') &&
        runnerStage.includes('1001') &&
        runnerStage.includes('nodejs'),
    ).toBe(true);
    expect(
      runnerStage.includes('adduser') &&
        runnerStage.includes('1001') &&
        runnerStage.includes('nodejs'),
    ).toBe(true);
    expect(runnerStage).toMatch(/USER\s+nodejs(:nodejs)?/);
    expect(runnerStage).toMatch(/EXPOSE\s+3000/);
    expect(runnerStage).toMatch(/HEALTHCHECK[\s\S]*http:\/\/127\.0\.0\.1:3000\/api\/health/);
  });

  it('verifies multi-stage build and artifact copying', () => {
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    expect(depsStage).toBeTruthy();
    expect(builderStage).toBeTruthy();
    expect(runnerStage).toBeTruthy();

    expect(runnerStage).toMatch(/COPY.*\.next\/standalone/);
    expect(runnerStage).toMatch(/COPY.*\.next\/static/);
    expect(runnerStage).toMatch(/COPY.*public/);
    expect(runnerStage).toMatch(/COPY.*scripts\/migrate\.mjs/);
    expect(runnerStage).toMatch(/COPY.*drizzle/);
    expect(runnerStage).toMatch(/COPY.*scripts\/worker\.mjs/);
    expect(runnerStage).toMatch(/COPY.*dist\/retention/);
    expect(runnerStage).toMatch(/COPY.*docker-entrypoint\.sh/);
  });
});
