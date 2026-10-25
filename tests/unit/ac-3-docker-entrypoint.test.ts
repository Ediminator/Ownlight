import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-3: Container Entrypoint & Migration Execution', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const entrypointPath = path.resolve(rootDir, 'docker-entrypoint.sh');

  it('AC-3: docker-entrypoint.sh exists with executable shell syntax', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    const content = fs.readFileSync(entrypointPath, 'utf8');
    expect(content.startsWith('#!/bin/sh') || content.startsWith('#!/bin/bash')).toBe(true);
  });

  it('AC-3: supports AUTO_MIGRATE=true defaulting to enabled and runs scripts/migrate.mjs', () => {
    const content = fs.readFileSync(entrypointPath, 'utf8');

    // Defaulting logic
    expect(content).toMatch(/AUTO_MIGRATE="\$\{AUTO_MIGRATE:-true\}"/);
    // Checks database readiness and runs migrate.mjs
    expect(content).toMatch(/node\s+scripts\/migrate\.mjs/);
  });

  it('AC-3: skips migration when AUTO_MIGRATE=false', () => {
    const content = fs.readFileSync(entrypointPath, 'utf8');

    expect(content).toMatch(/if\s+\[\s*"\$AUTO_MIGRATE"\s*=\s*"true"\s*\]/);
    expect(content).toMatch(/skipping migrations/i);
  });

  it('AC-3: forwards signals cleanly to child process via exec "$@"', () => {
    const content = fs.readFileSync(entrypointPath, 'utf8');

    expect(content).toMatch(/exec\s+"\$@"/);
    expect(content).toMatch(/trap.*TERM/);
    expect(content).toMatch(/trap.*INT/);
  });
});
