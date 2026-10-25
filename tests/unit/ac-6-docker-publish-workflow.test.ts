import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('TASK-0051 / AC-6: GitHub Actions GHCR Pipeline & Supply Chain Security', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const workflowPath = path.resolve(rootDir, '.github/workflows/docker-publish.yml');

  it('AC-1: pins all third-party Docker actions to verified 40-character commit SHAs with version comments', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = fs.readFileSync(workflowPath, 'utf8');

    const expectedPinnedActions: Record<string, { sha: string; version: string }> = {
      'docker/setup-buildx-action': {
        sha: '8d2750c68a42422c14e847fe6c8ac0403b4cbd6f',
        version: '# v3.12.0',
      },
      'docker/login-action': {
        sha: 'c94ce9fb468520275223c153574b00df6fe4bcc9',
        version: '# v3.4.0',
      },
      'docker/metadata-action': {
        sha: 'c299e40c65443455700f0fdfc63efafe5b349051',
        version: '# v5.6.1',
      },
      'docker/build-push-action': {
        sha: '10e90e3645eae34f1e60eeb005ba3a3d33f178e8',
        version: '# v6.19.2',
      },
    };

    const lines = content.split(/\r?\n/);
    const foundActions = new Map<string, { sha: string; comment: string }>();

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- uses:') || trimmed.startsWith('uses:')) {
        const usesRegex = /uses:\s*([^\s#]+)(.*)$/;
        const match = usesRegex.exec(trimmed);
        if (match) {
          const actionRef = match[1];
          const comment = (match[2] ?? '').trim();
          if (actionRef && !actionRef.startsWith('./')) {
            const [actionName, sha] = actionRef.split('@');
            expect(sha).toMatch(/^[0-9a-f]{40}$/i);
            expect(comment).toMatch(/^#\s*v/);
            if (actionName && sha) {
              foundActions.set(actionName, { sha, comment });
            }
          }
        }
      }
    }

    for (const [actionName, expected] of Object.entries(expectedPinnedActions)) {
      const action = foundActions.get(actionName);
      expect(action).toBeDefined();
      expect(action?.sha).toBe(expected.sha);
      expect(action?.comment).toBe(expected.version);
    }
  });

  it('AC-2: passes pnpm run lint:actions validation without errors', () => {
    const output = execSync('node scripts/lint-actions.mjs', {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(output).toContain('Static policy checks passed');
    expect(output).toContain('All workflow linter and security checks passed!');
  });

  it('AC-3: verifies automated workflow configuration, permissions, and build targets', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');

    // Trigger configuration
    expect(content).toMatch(/branches:\s*\n\s*-\s*main/);
    expect(content).toMatch(/tags:/);
    expect(content).toMatch(/paths:/);

    // Permissions and timeouts
    expect(content.includes('permissions: {}')).toBe(true);
    expect(content).toMatch(/timeout-minutes:\s*30/);
    expect(content).toMatch(/contents:\s*read/);
    expect(content).toMatch(/packages:\s*write/);

    // Checkout credential hygiene
    expect(content).toContain('persist-credentials: false');

    // Build platform and target tags
    expect(content).toContain('ghcr.io');
    expect(content).toContain('linux/amd64');
    expect(content).toContain('ghcr.io/ediminator/ownlight:latest');
    expect(content).toContain('ghcr.io/ediminator/ownlight:${{ github.sha }}');
  });
});
