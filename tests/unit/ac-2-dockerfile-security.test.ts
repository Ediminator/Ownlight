import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Dockerfile Configuration & Security (TASK-0053)', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const dockerfilePath = path.resolve(rootDir, 'Dockerfile');
  const packageJsonPath = path.resolve(rootDir, 'package.json');
  const content = fs.readFileSync(dockerfilePath, 'utf8');
  interface PackageJson {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;

  // Helper to extract stages (using multiline match to only split on Dockerfile FROM instructions)
  const stages = content.split(/^FROM\s+/im).slice(1);
  const depsStage = stages.find((s) => s.startsWith('node:24.2.0-alpine3.21 AS deps')) ?? '';
  const prodDepsStage =
    stages.find((s) => s.startsWith('node:24.2.0-alpine3.21 AS prod-deps')) ?? '';
  const builderStage = stages.find((s) => s.startsWith('node:24.2.0-alpine3.21 AS builder')) ?? '';
  const runnerStage = stages.find((s) => s.startsWith('node:24.2.0-alpine3.21 AS runner')) ?? '';

  it('AC-2: deps and prod-deps stages copy pnpm-workspace.yaml and install with --frozen-lockfile --ignore-scripts without lefthook or git', () => {
    expect(depsStage).toBeTruthy();
    expect(prodDepsStage).toBeTruthy();

    // D2: pnpm-workspace.yaml must be copied into both deps and prod-deps
    expect(depsStage).toMatch(
      /COPY\s+package\.json\s+pnpm-lock\.yaml\s+pnpm-workspace\.yaml\s+\.\//,
    );
    expect(prodDepsStage).toMatch(
      /COPY\s+package\.json\s+pnpm-lock\.yaml\s+pnpm-workspace\.yaml\s+\.\//,
    );

    // D1: Must use --ignore-scripts so root prepare (lefthook install) is never executed during container build
    expect(depsStage).toMatch(
      /pnpm\s+install\s+.*--frozen-lockfile\s+.*--ignore-scripts|pnpm\s+install\s+.*--ignore-scripts\s+.*--frozen-lockfile/,
    );
    expect(prodDepsStage).toMatch(
      /pnpm\s+install\s+.*--prod\s+.*--frozen-lockfile\s+.*--ignore-scripts/,
    );

    // Neither stage should mention lefthook or git
    expect(content.toLowerCase().includes('lefthook')).toBe(false);
    expect(content.toLowerCase().includes('git ')).toBe(false);
  });

  it('AC-4: runner stage copies node_modules from prod-deps stage and @electric-sql/pglite is an exact production dependency', () => {
    // D4: Runner must obtain node_modules from prod-deps stage rather than standalone tracing
    expect(runnerStage).toMatch(/COPY\s+--from=prod-deps.*\/app\/node_modules\s+\.\/node_modules/);

    // Runner must selectively copy standalone server assets, NOT standalone/node_modules
    expect(runnerStage).not.toMatch(
      /COPY\s+--from=builder.*\/app\/\.next\/standalone\s+\.\/(?![\w.-])/,
    );
    expect(runnerStage).toMatch(
      /COPY\s+--from=builder.*\/app\/\.next\/standalone\/server\.js\s+\.\/server\.js/,
    );
    expect(runnerStage).toMatch(
      /COPY\s+--from=builder.*\/app\/\.next\/standalone\/package\.json\s+\.\/package\.json/,
    );
    expect(runnerStage).toMatch(
      /COPY\s+--from=builder.*\/app\/\.next\/standalone\/\.next\s+\.\/\.next/,
    );

    // D5: @electric-sql/pglite must be declared in dependencies, not devDependencies, at exact version
    expect(packageJson.dependencies).toHaveProperty('@electric-sql/pglite');
    expect(packageJson.devDependencies?.['@electric-sql/pglite']).toBeUndefined();
    expect(packageJson.dependencies?.['@electric-sql/pglite']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('AC-7: maintains unprivileged nodejs user (UID 1001, GID 1001), healthcheck, port 3000 exposure, and no baked secrets', () => {
    expect(
      runnerStage.includes('addgroup') &&
        runnerStage.includes('1001') &&
        runnerStage.includes('nodejs'),
    ).toBe(true);
    expect(
      runnerStage.includes('adduser') &&
        runnerStage.includes('1001') &&
        runnerStage.includes('nodejs'),
    ).toBe(true);
    expect(runnerStage).toMatch(/USER\s+nodejs(:nodejs)?/);
    expect(runnerStage).toMatch(/EXPOSE\s+3000/);
    expect(runnerStage).toMatch(/HEALTHCHECK[\s\S]*http:\/\/127\.0\.0\.1:3000\/api\/health/);

    // No secrets or credentials baked into image layers
    expect(content.includes('AUTH_SECRET=')).toBe(false);
    expect(content.includes('ENCRYPTION_KEY=')).toBe(false);
    expect(content.includes('DATABASE_URL=')).toBe(false);
  });

  it('verifies multi-stage build, libc6-compat, and artifact copying across stages', () => {
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    expect(depsStage).toMatch(/npm\s+install\s+-g\s+pnpm@12\.10\.1/);
    expect(prodDepsStage).toMatch(/npm\s+install\s+-g\s+pnpm@12\.10\.1/);
    expect(builderStage).toMatch(/npm\s+install\s+-g\s+pnpm@12\.10\.1/);

    // All stages install libc6-compat
    expect(depsStage).toMatch(/apk\s+add\s+--no-cache\s+libc6-compat/);
    expect(prodDepsStage).toMatch(/apk\s+add\s+--no-cache\s+libc6-compat/);
    expect(builderStage).toMatch(/apk\s+add\s+--no-cache\s+libc6-compat/);
    expect(runnerStage).toMatch(/apk\s+add\s+--no-cache\s+libc6-compat/);

    // Builder sets SKIP_ENV_VALIDATION=true for build only, runner does not
    expect(builderStage).toMatch(/ENV\s+SKIP_ENV_VALIDATION=true/);
    expect(runnerStage.includes('SKIP_ENV_VALIDATION')).toBe(false);

    // Required application artifacts are copied to runner
    expect(runnerStage).toMatch(/COPY.*\.next\/static/);
    expect(runnerStage).toMatch(/COPY.*public/);
    expect(runnerStage).toMatch(/COPY.*scripts\/migrate\.mjs/);
    expect(runnerStage).toMatch(/COPY.*drizzle/);
    expect(runnerStage).toMatch(/COPY.*scripts\/worker\.mjs/);
    expect(runnerStage).toMatch(/COPY.*dist\/retention/);
    expect(runnerStage).toMatch(/COPY.*docker-entrypoint\.sh/);
  });
});
