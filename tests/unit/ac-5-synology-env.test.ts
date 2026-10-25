import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('AC-5: Synology Environment Configuration Template', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const envExamplePath = path.resolve(rootDir, '.env.synology.example');
  const gitignorePath = path.resolve(rootDir, '.gitignore');

  it('AC-5: .env.synology.example exists and documents all required production variables', () => {
    expect(fs.existsSync(envExamplePath)).toBe(true);
    const content = fs.readFileSync(envExamplePath, 'utf8');

    expect(content).toMatch(/PORT=3030/);
    expect(content).toMatch(/AUTH_URL=/);
    expect(content).toMatch(/TRUSTED_PROXY_COUNT=/);
    expect(content).toMatch(/POSTGRES_DB=/);
    expect(content).toMatch(/POSTGRES_USER=/);
    expect(content).toMatch(/POSTGRES_PASSWORD=/);
    expect(content).toMatch(/POSTGRES_APP_USER=/);
    expect(content).toMatch(/POSTGRES_APP_PASSWORD=/);
    expect(content).toMatch(/POSTGRES_MIGRATOR_USER=/);
    expect(content).toMatch(/POSTGRES_MIGRATOR_PASSWORD=/);
    expect(content).toMatch(/AUTH_SECRET=/);
    expect(content).toMatch(/SETUP_TOKEN=/);
    expect(content).toMatch(/ENCRYPTION_KEY=/);
    expect(content).toMatch(/AUTO_MIGRATE=/);
  });

  it('AC-5: .env.synology.example contains placeholder values only and no real secrets', () => {
    const content = fs.readFileSync(envExamplePath, 'utf8');

    // No real base64 / hex keys
    expect(content).not.toMatch(/AUTH_SECRET=[A-Za-z0-9+/]{43}=/);
    expect(content).not.toMatch(/ENCRYPTION_KEY=[a-f0-9]{64}/);
    expect(content).toMatch(/replace_with_/i);
  });

  it('AC-5: .env.synology is ignored by .gitignore and not tracked by git', () => {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    // .gitignore must have an entry matching .env.synology
    const ignoresSynology =
      /^\.env\.synology$/m.test(gitignoreContent) ||
      /^\.env\.\*$/m.test(gitignoreContent) ||
      /^\.env\*$/m.test(gitignoreContent) ||
      /^\*\.env\*$/m.test(gitignoreContent);

    expect(ignoresSynology).toBe(true);

    try {
      const result = execSync('git check-ignore .env.synology', {
        cwd: rootDir,
        encoding: 'utf8',
      });
      expect(result.trim()).toContain('.env.synology');
    } catch (err: unknown) {
      // In case git command fails because .env.synology rule is missing
      expect(err).toBeNull();
    }
  });
});
