import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('GitHub Actions GHCR Pipeline & Container Verification (TASK-0053)', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const workflowPath = path.resolve(rootDir, '.github/workflows/docker-publish.yml');
  const content = fs.readFileSync(workflowPath, 'utf8');

  it('AC-1: triggers on pull_request and workflow_dispatch, builds linux/amd64 with load: true, and skips publish on PRs', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);

    // Triggers
    expect(content).toMatch(/pull_request:\s*\n\s*branches:\s*\n\s*-\s*main/);
    expect(content).toMatch(/workflow_dispatch:/);

    // Single build step with load: true for local daemon testing
    expect(content).toMatch(/load:\s*true/);
    expect(content).toContain('platforms: linux/amd64');

    // Login and push steps are strictly gated by github.event_name == 'push'
    const loginMatch = /- name: Log in to GitHub Container Registry[\s\S]*?if:\s*([^\n]+)/.exec(
      content,
    );
    expect(loginMatch).toBeTruthy();
    expect(loginMatch?.[1]).toContain("github.event_name == 'push'");

    const pushMatch = /- name: Push Docker image to GHCR[\s\S]*?if:\s*([^\n]+)/.exec(content);
    expect(pushMatch).toBeTruthy();
    expect(pushMatch?.[1]).toContain("github.event_name == 'push'");
  });

  it('AC-5: performs web container boot and migration smoke test against postgres service', () => {
    // Defines postgres:16.8-alpine3.21 service container
    expect(content).toContain('image: postgres:16.8-alpine3.21');

    // Runs web container with AUTO_MIGRATE=true on host network
    expect(content).toMatch(/docker run -d --network host[\s\S]*?-e AUTO_MIGRATE=true/);

    // Polls /api/health for up to 90 seconds
    expect(content).toContain('/api/health');
    expect(content).toMatch(/seq 1 90/);
    expect(content).toMatch(
      /curl -s -o \/dev\/null -w "%\{http_code\}" http:\/\/127\.0\.0\.1:3000\/api\/health/,
    );
  });

  it('AC-6: performs background worker container liveness smoke test', () => {
    // Runs worker with AUTO_MIGRATE=false under timeout 20
    expect(content).toMatch(/timeout 20 docker run[\s\S]*?node scripts\/worker\.mjs/);
    expect(content).toMatch(/-e AUTO_MIGRATE=false/);

    // Verifies timeout exit code 124 (process still healthy after 20s)
    expect(content).toMatch(/EXIT_CODE.*?124/);
  });

  it('AC-7: maintains security posture with zero-privilege defaults, action pinning, masked secrets, and credential hygiene', () => {
    // Top-level permissions
    expect(content.includes('permissions: {}')).toBe(true);
    expect(content).toMatch(/timeout-minutes:\s*30/);
    expect(content).toMatch(/contents:\s*read/);
    expect(content).toMatch(/packages:\s*write/);

    // Checkout credential hygiene
    expect(content).toContain('persist-credentials: false');

    // Generated throwaway secrets per run with masking
    expect(content).toMatch(/openssl rand -hex 32/);
    expect(content).toMatch(/echo "::add-mask::\$/);

    // Pinned actions with version comments
    const expectedPinnedActions: Record<string, { sha: string; version: string }> = {
      'actions/checkout': {
        sha: '3d3c42e5aac5ba805825da76410c181273ba90b1',
        version: '# v7.0.1',
      },
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

  it('AC-8: negative failure paths print container logs and fail the workflow on container failure', () => {
    // Both web and worker smoke failure paths print docker logs and exit with non-zero status
    expect(content).toMatch(/docker logs "\$WEB_CONTAINER_ID"[\s\S]*?exit 1/);
    expect(content).toMatch(/docker logs "\$WORKER_CONTAINER_ID"[\s\S]*?exit 1/);
  });

  it('passes pnpm run lint:actions validation without errors', () => {
    const output = execSync('node scripts/lint-actions.mjs', {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(output).toContain('Static policy checks passed');
    expect(output).toContain('All workflow linter and security checks passed!');
  });
});
