import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

interface QualityStep {
  id: string;
  name: string;
  cmd: string;
}

interface QualityStepsDoc {
  name: string;
  steps: QualityStep[];
}

describe('AC-4: Gate parity between quality-steps.json and ci.yml', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const qualityStepsPath = path.resolve(rootDir, 'quality-steps.json');
  const ciWorkflowPath = path.resolve(rootDir, '.github/workflows/ci.yml');

  it('AC-4: quality-steps.json exists at repository root and is self-contained', () => {
    expect(fs.existsSync(qualityStepsPath)).toBe(true);
    const raw = fs.readFileSync(qualityStepsPath, 'utf8');

    // Must not reference files outside repository
    expect(raw).not.toMatch(/\.\.\//);
    expect(raw).not.toMatch(/control\//);

    const doc = JSON.parse(raw) as QualityStepsDoc;
    expect(doc.steps.length).toBeGreaterThanOrEqual(10);
  });

  it('AC-4: every step in quality-steps.json is invoked in ci.yml in matching order', () => {
    const doc = JSON.parse(fs.readFileSync(qualityStepsPath, 'utf8')) as QualityStepsDoc;
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');

    let lastIndex = -1;

    for (const step of doc.steps) {
      // Step cmd must be present as a run command in ci.yml
      const escapedCmd = step.cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stepRegex = new RegExp(`run:\\s*${escapedCmd}\\b`);

      const match = stepRegex.exec(ciContent);
      expect(
        match,
        `Step "${step.id}" with command "${step.cmd}" must be invoked in ci.yml`,
      ).not.toBeNull();

      if (match) {
        expect(
          match.index,
          `Step "${step.id}" must appear after preceding steps in ci.yml`,
        ).toBeGreaterThan(lastIndex);
        lastIndex = match.index;
      }
    }
  });

  it('AC-4: ci.yml includes PostgreSQL service container with healthcheck', () => {
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');
    expect(ciContent).toContain('services:');
    expect(ciContent).toMatch(/image:\s*postgres:16/);
    expect(ciContent).not.toContain('public.ecr.aws');
    expect(ciContent).toContain('--health-cmd');
    expect(ciContent).toContain('pg_isready');
  });

  it('AC-4: ci.yml caches pnpm store and Playwright browsers', () => {
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');
    expect(ciContent).toContain('actions/cache');
    expect(ciContent).toMatch(/pnpm-store/);
    expect(ciContent).toMatch(/playwright/);
  });

  it('AC-4: ci.yml uploads Playwright report on failure and CycloneDX SBOM artifact', () => {
    const ciContent = fs.readFileSync(ciWorkflowPath, 'utf8');
    expect(ciContent).toContain('name: playwright-report');
    expect(ciContent).toContain('if: failure()');
    expect(ciContent).toMatch(/@cyclonedx\/cdxgen/);
    expect(ciContent).toContain('name: cyclonedx-sbom');
    expect(ciContent).toContain('retention-days: 14');
  });
});
