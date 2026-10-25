import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-4: Synology Docker Compose Stack & Host Port Isolation', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const composePath = path.resolve(rootDir, 'compose.synology.yml');

  it('AC-4: compose.synology.yml exists and declares web, worker, and db services with unless-stopped restart policy', () => {
    expect(fs.existsSync(composePath)).toBe(true);
    const content = fs.readFileSync(composePath, 'utf8');

    expect(content).toMatch(/web:\s*\n/);
    expect(content).toMatch(/worker:\s*\n/);
    expect(content).toMatch(/db:\s*\n/);
    // Restart policy unless-stopped
    expect(content).toMatch(/restart:\s*unless-stopped/);
  });

  it('AC-4: web service maps port 3000 to host port ${PORT:-3030} preventing Gitea collision', () => {
    const content = fs.readFileSync(composePath, 'utf8');

    expect(content).toMatch(/['"]?\$\{PORT:-3030\}:3000['"]?/);
  });

  it('AC-4: worker service executes node scripts/worker.mjs and does not publish ports', () => {
    const content = fs.readFileSync(composePath, 'utf8');

    // Find worker block
    const workerSection =
      content.split(/worker:\s*\n/)[1]?.split(/\n\s{2}[a-z0-9_-]+:\s*\n/)[0] ?? '';
    expect(workerSection).toMatch(
      /command:\s*(node\s+scripts\/worker\.mjs|\[['"]node['"],\s*['"]scripts\/worker\.mjs['"]\])/,
    );
    expect(workerSection).not.toMatch(/ports:/);
  });

  it('AC-4: db service runs postgres:18.1-alpine3.21 with healthcheck, persistent volume, and init-roles.sh mount', () => {
    const content = fs.readFileSync(composePath, 'utf8');

    expect(content).toMatch(/image:\s*postgres:18\.1-alpine3\.21/);
    expect(content).toMatch(/pg_isready/);
    expect(content).toMatch(/ownlight_postgres_data/);
    expect(content).toMatch(/init-roles\.sh.*:ro/);
  });

  it('AC-4: contains zero hardcoded plaintext passwords or secret fallback defaults', () => {
    const content = fs.readFileSync(composePath, 'utf8');

    // Forbidden hardcoded fallback passwords in compose (no ${VAR:-default})
    expect(content).not.toMatch(/\$\{POSTGRES_PASSWORD:-/);
    expect(content).not.toMatch(/\$\{POSTGRES_APP_PASSWORD:-/);
    expect(content).not.toMatch(/\$\{POSTGRES_MIGRATOR_PASSWORD:-/);
    expect(content).not.toMatch(/\$\{AUTH_SECRET:-/);
    expect(content).not.toMatch(/\$\{ENCRYPTION_KEY:-/);

    // Should use mandatory error expressions or clean env references
    expect(content).toMatch(/POSTGRES_PASSWORD/);
  });
});
