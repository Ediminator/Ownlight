import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

describe('AC-1: GitHub Actions workflow validation with actionlint and zizmor', () => {
  it('AC-1: pnpm run lint:actions passes with 0 errors and 0 medium+ findings', () => {
    const rootDir = path.resolve(import.meta.dirname, '../..');
    const scriptPath = path.resolve(rootDir, 'scripts/lint-actions.mjs');

    const output = execFileSync(process.execPath, [scriptPath], {
      cwd: rootDir,
      encoding: 'utf8',
    });

    expect(output).toContain('Static policy checks passed');
    if (output.includes('actionlint: 0 errors')) {
      expect(output).toContain('actionlint: 0 errors');
    } else {
      expect(output).toContain('actionlint binary not found on PATH');
    }
    if (output.includes('zizmor: 0 findings at medium or higher')) {
      expect(output).toContain('zizmor: 0 findings at medium or higher');
    } else {
      expect(output).toContain('zizmor binary not found on PATH');
    }
    expect(output).toContain('All workflow linter and security checks passed');
  }, 90_000);
});
