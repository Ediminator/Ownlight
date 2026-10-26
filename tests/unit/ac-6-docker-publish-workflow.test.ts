import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

export const EXPECTED_DOCKER_ACTIONS = [
  'actions/checkout',
  'docker/setup-buildx-action',
  'docker/login-action',
  'docker/metadata-action',
  'docker/build-push-action',
] as const;

export interface ActionVerificationResult {
  valid: boolean;
  foundActions: Map<string, { sha: string; comment: string }>;
  errors: string[];
}

export function verifyWorkflowActionPinning(
  workflowContent: string,
  expectedActions: readonly string[] = EXPECTED_DOCKER_ACTIONS,
): ActionVerificationResult {
  const lines = workflowContent.split(/\r?\n/);
  const foundActions = new Map<string, { sha: string; comment: string }>();
  const errors: string[] = [];
  const usesRegex = /uses:\s*([^\s#]+)(.*)$/;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- uses:') || trimmed.startsWith('uses:')) {
      const match = usesRegex.exec(trimmed);
      if (match) {
        const actionRef = match[1] ?? '';
        const comment = (match[2] ?? '').trim();

        if (actionRef && !actionRef.startsWith('./')) {
          const atIndex = actionRef.indexOf('@');
          const lineNum = String(index + 1);
          if (atIndex === -1) {
            errors.push(`Line ${lineNum}: Action "${actionRef}" is missing '@' delimiter`);
            return;
          }

          const actionName = actionRef.slice(0, atIndex);
          const sha = actionRef.slice(atIndex + 1);

          // Invariant 1: Action path format owner/repo or owner/repo/path
          const parts = actionName.split('/');
          const isFormatValid =
            (parts.length === 2 || parts.length === 3) &&
            parts.every((p) => p.length > 0 && /^[\w.-]+$/.test(p));
          if (!isFormatValid) {
            errors.push(
              `Line ${lineNum}: Action name "${actionName}" has invalid repository format`,
            );
          }

          // Invariant 2: Exactly 40 lowercase hexadecimal characters
          if (!/^[0-9a-f]{40}$/.test(sha)) {
            errors.push(
              `Line ${lineNum}: Action "${actionName}" ref "${sha}" is not a 40-character lowercase hex SHA`,
            );
          }

          // Invariant 3: Version comment matching # vMAJOR.MINOR.PATCH (semver)
          if (!/^#\s*v\d+\.\d+\.\d+$/.test(comment)) {
            errors.push(
              `Line ${lineNum}: Action "${actionName}" has invalid or missing version comment "${comment}" (expected "# vX.Y.Z")`,
            );
          }

          foundActions.set(actionName, { sha, comment });
        }
      }
    }
  });

  // Invariant 4: Required set of action repositories
  for (const expected of expectedActions) {
    if (!foundActions.has(expected)) {
      errors.push(`Missing expected action repository "${expected}"`);
    }
  }

  return {
    valid: errors.length === 0,
    foundActions,
    errors,
  };
}

describe('GitHub Actions GHCR Pipeline & Container Verification (TASK-0053, TASK-0054)', () => {
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

    // Pinned actions with version comments (invariant check: 40-char lowercase hex + # vX.Y.Z)
    const verification = verifyWorkflowActionPinning(content, EXPECTED_DOCKER_ACTIONS);
    expect(verification.errors).toEqual([]);
    expect(verification.valid).toBe(true);
    for (const actionName of EXPECTED_DOCKER_ACTIONS) {
      expect(verification.foundActions.has(actionName)).toBe(true);
    }
  });

  it('AC-1: version-agnostic action-pinning test passes when action SHA and version comment change to another valid 40-hex SHA and # vX.Y.Z comment', () => {
    // Modify Docker actions with new arbitrary valid 40-hex lowercase SHAs and semver comments
    const modifiedContent = content
      .replace(
        /uses: docker\/setup-buildx-action@[^\n]+/,
        'uses: docker/setup-buildx-action@a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e # v4.0.0',
      )
      .replace(
        /uses: docker\/metadata-action@[^\n]+/,
        'uses: docker/metadata-action@f0e1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d # v6.0.0',
      )
      .replace(
        /uses: docker\/build-push-action@[^\n]+/,
        'uses: docker/build-push-action@1234567890abcdef1234567890abcdef12345678 # v7.1.2',
      )
      .replace(
        /uses: docker\/login-action@[^\n]+/,
        'uses: docker/login-action@fedcba0987654321fedcba0987654321fedcba09 # v4.1.0',
      );

    const verification = verifyWorkflowActionPinning(modifiedContent, EXPECTED_DOCKER_ACTIONS);
    expect(verification.errors).toEqual([]);
    expect(verification.valid).toBe(true);
    expect(verification.foundActions.get('docker/setup-buildx-action')?.sha).toBe(
      'a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e',
    );
    expect(verification.foundActions.get('docker/setup-buildx-action')?.comment).toBe('# v4.0.0');
  });

  it('AC-2: action-pinning fails when an action uses a mutable tag reference instead of commit SHA', () => {
    const tagVariant = content.replace(
      /uses: docker\/setup-buildx-action@[^\n]+/,
      'uses: docker/setup-buildx-action@v3.12.0 # v3.12.0',
    );
    const result = verifyWorkflowActionPinning(tagVariant, EXPECTED_DOCKER_ACTIONS);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes('docker/setup-buildx-action') &&
          e.includes('not a 40-character lowercase hex SHA'),
      ),
    ).toBe(true);
  });

  it('AC-2: action-pinning fails when an action uses a short SHA', () => {
    const shortShaVariant = content.replace(
      /uses: docker\/setup-buildx-action@[^\n]+/,
      'uses: docker/setup-buildx-action@8d2750c # v3.12.0',
    );
    const result = verifyWorkflowActionPinning(shortShaVariant, EXPECTED_DOCKER_ACTIONS);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes('docker/setup-buildx-action') &&
          e.includes('not a 40-character lowercase hex SHA'),
      ),
    ).toBe(true);
  });

  it('AC-2: action-pinning fails when an action uses an uppercase or non-hex SHA', () => {
    // Uppercase hex SHA
    const uppercaseVariant = content.replace(
      /uses: docker\/build-push-action@[^\n]+/,
      'uses: docker/build-push-action@10E90E3645EAE34F1E60EEB005BA3A3D33F178E8 # v6.19.2',
    );
    const uppercaseResult = verifyWorkflowActionPinning(uppercaseVariant, EXPECTED_DOCKER_ACTIONS);
    expect(uppercaseResult.valid).toBe(false);
    expect(
      uppercaseResult.errors.some(
        (e) =>
          e.includes('docker/build-push-action') &&
          e.includes('not a 40-character lowercase hex SHA'),
      ),
    ).toBe(true);

    // Non-hex SHA
    const nonHexVariant = content.replace(
      /uses: docker\/build-push-action@[^\n]+/,
      'uses: docker/build-push-action@10e90e3645eae34f1e60eeb005ba3a3d33f178zz # v6.19.2',
    );
    const nonHexResult = verifyWorkflowActionPinning(nonHexVariant, EXPECTED_DOCKER_ACTIONS);
    expect(nonHexResult.valid).toBe(false);
    expect(
      nonHexResult.errors.some(
        (e) =>
          e.includes('docker/build-push-action') &&
          e.includes('not a 40-character lowercase hex SHA'),
      ),
    ).toBe(true);
  });

  it('AC-2: action-pinning fails when an action has missing or non-semver version comment', () => {
    // Missing comment entirely
    const noCommentVariant = content.replace(
      /uses: docker\/login-action@[^\n]+/,
      'uses: docker/login-action@74a5d142397b4f367a81961eba4e8cd7edddf772',
    );
    const noCommentResult = verifyWorkflowActionPinning(noCommentVariant, EXPECTED_DOCKER_ACTIONS);
    expect(noCommentResult.valid).toBe(false);
    expect(
      noCommentResult.errors.some(
        (e) =>
          e.includes('docker/login-action') && e.includes('invalid or missing version comment'),
      ),
    ).toBe(true);

    // Invalid non-semver comment (e.g. # latest or # v3)
    const invalidCommentVariant = content.replace(
      /uses: docker\/login-action@[^\n]+/,
      'uses: docker/login-action@74a5d142397b4f367a81961eba4e8cd7edddf772 # latest',
    );
    const invalidCommentResult = verifyWorkflowActionPinning(
      invalidCommentVariant,
      EXPECTED_DOCKER_ACTIONS,
    );
    expect(invalidCommentResult.valid).toBe(false);
    expect(
      invalidCommentResult.errors.some(
        (e) =>
          e.includes('docker/login-action') && e.includes('invalid or missing version comment'),
      ),
    ).toBe(true);
  });

  it('AC-3: action set enforcement fails when an expected Docker action is missing', () => {
    const missingActionVariant = content.replace(
      /- name: Extract Docker metadata[\s\S]*?uses: docker\/metadata-action@[^\n]+/,
      '# metadata-action step omitted',
    );
    const result = verifyWorkflowActionPinning(missingActionVariant, EXPECTED_DOCKER_ACTIONS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing expected action repository "docker/metadata-action"');
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
