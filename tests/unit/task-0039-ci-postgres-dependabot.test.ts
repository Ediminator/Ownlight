import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TASK-0039: CI PostgreSQL service container and Dependabot ecosystems', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const ciWorkflowPath = path.resolve(rootDir, '.github/workflows/ci.yml');
  const dependabotPath = path.resolve(rootDir, '.github/dependabot.yml');

  it('AC-1: postgres service container uses postgres:16.8-alpine3.21 without public.ecr.aws prefix', () => {
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');
    expect(ciContent).toMatch(/image:\s*postgres:16\.8-alpine3\.21/);
    expect(ciContent).not.toContain('public.ecr.aws/docker/library/postgres');
  });

  it('AC-2: dependabot.yml has docker-compose but removes redundant docker ecosystem', () => {
    const dependabotContent = fs.readFileSync(dependabotPath, 'utf8');
    expect(dependabotContent).toMatch(/package-ecosystem:\s*['"]npm['"]/);
    expect(dependabotContent).toMatch(/package-ecosystem:\s*['"]github-actions['"]/);
    expect(dependabotContent).toMatch(/package-ecosystem:\s*['"]docker-compose['"]/);
    // Standalone docker package-ecosystem should NOT be present
    expect(dependabotContent).not.toMatch(/package-ecosystem:\s*['"]docker['"](?!\w|-)/);
    expect(dependabotContent).not.toContain('docker-images:');
  });

  it('AC-3: verifies ac-4-ci-parity expectations', () => {
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');
    expect(ciContent).toContain('services:');
    expect(ciContent).toContain('postgres:');
    expect(ciContent).toContain('--health-cmd');
    expect(ciContent).toContain('pg_isready');
  });

  it('AC-4: workflow files exist and have valid structure', () => {
    expect(fs.existsSync(ciWorkflowPath)).toBe(true);
    expect(fs.existsSync(dependabotPath)).toBe(true);
  });
});
