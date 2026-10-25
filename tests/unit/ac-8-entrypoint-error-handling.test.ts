import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-8: Insecure Port & Migration Failure Error Handling', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const entrypointPath = path.resolve(rootDir, 'docker-entrypoint.sh');
  const deployScriptPath = path.resolve(rootDir, 'scripts/deploy-synology.sh');
  const docsPath = path.resolve(rootDir, 'docs/operations/synology-deployment.md');

  it('AC-8: documentation and deploy scripts warn against configuring PORT=3000 (Gitea port collision)', () => {
    const deployContent = fs.readFileSync(deployScriptPath, 'utf8');
    const docsContent = fs.readFileSync(docsPath, 'utf8');

    expect(deployContent).toMatch(/3000.*(Gitea|collision|conflict)/i);
    expect(docsContent).toMatch(/3000.*(Gitea|collision|conflict)/i);
  });

  it('AC-8: docker-entrypoint.sh redacts credentials in database URLs on error and logs sanitized messages', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');

    // Should include sanitization logic for URLs
    expect(entrypointContent).toMatch(/sed\s+.*s(\/|\|):(\/\/)?[^:]+:[^@]+@/);
  });

  it('AC-8: docker-entrypoint.sh exits with non-zero code on failure', () => {
    const entrypointContent = fs.readFileSync(entrypointPath, 'utf8');

    // Should contain non-zero exit codes on failure
    expect(entrypointContent).toMatch(/exit\s+1/);
    expect(entrypointContent).toMatch(/set\s+-e/);
  });
});
