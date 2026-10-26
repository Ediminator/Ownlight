import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Docker Build Context Hygiene (.dockerignore) (TASK-0053)', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const dockerignorePath = path.resolve(rootDir, '.dockerignore');

  it('AC-3: verifies .dockerignore exists and excludes required secrets, build outputs, and caches', () => {
    expect(fs.existsSync(dockerignorePath)).toBe(true);
    const content = fs.readFileSync(dockerignorePath, 'utf8');
    const lines = content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    // Excluded build artifacts and version control
    expect(lines).toContain('.git');
    expect(lines).toContain('node_modules');
    expect(lines).toContain('.next');
    expect(lines).toContain('dist');

    // Secret protection
    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');

    // Re-inclusion of documentation / example environment templates
    expect(lines.some((l) => l === '!*.example' || l === '!**/*.example')).toBe(true);

    // Development database and test artifacts
    expect(lines).toContain('.pglite-dev');
    expect(lines).toContain('coverage');
    expect(lines).toContain('test-results');
    expect(lines).toContain('playwright-report');
    expect(lines).toContain('*.log');
  });
});
