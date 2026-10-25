import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('AC-6: GitHub Actions GHCR Pipeline & Supply Chain Security', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const workflowPath = path.resolve(rootDir, '.github/workflows/docker-publish.yml');

  it('AC-6: docker-publish.yml exists and triggers on push to main and tags with path filtering', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content).toMatch(/branches:\s*\n\s*-\s*main/);
    expect(content).toMatch(/tags:/);
    expect(content).toMatch(/paths:/);
  });

  it('AC-6: enforces zero top-level permissions and explicit job permissions (contents: read, packages: write)', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content.includes('permissions: {}')).toBe(true);
    expect(content).toMatch(/timeout-minutes:\s*30/);
    expect(content).toMatch(/contents:\s*read/);
    expect(content).toMatch(/packages:\s*write/);
  });

  it('AC-6: pins all third-party GitHub Actions to 40-character SHAs with version comments', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- uses:') || trimmed.startsWith('uses:')) {
        const usesRegex = /uses:\s*([^\s#]+)(.*)$/;
        const match = usesRegex.exec(trimmed);
        if (match) {
          const actionRef = match[1];
          const comment = (match[2] ?? '').trim();
          if (actionRef && !actionRef.startsWith('./')) {
            const parts = actionRef.split('@');
            expect(parts.length).toBe(2);
            const sha = parts[1];
            expect(sha).toMatch(/^[0-9a-f]{40}$/i);
            expect(comment).toMatch(/^#\s*v/);
          }
        }
      }
    }
  });

  it('AC-6: builds for linux/amd64 and pushes both latest and commit sha tags to ghcr.io/ediminator/ownlight', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');

    expect(content).toMatch(/ghcr\.io/);
    expect(content).toMatch(/linux\/amd64/);
    expect(content).toMatch(/ghcr\.io\/ediminator\/ownlight:latest/);
    expect(content).toMatch(/ghcr\.io\/ediminator\/ownlight:\${{\s*github\.sha\s*}}/);
  });

  it('AC-6: passes pnpm run lint:actions validation without errors', () => {
    const output = execSync('node scripts/lint-actions.mjs', {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(output).toContain('Static policy checks passed');
  });
});
