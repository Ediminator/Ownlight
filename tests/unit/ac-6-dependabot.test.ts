import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('AC-6: Dependency automation configuration (Dependabot)', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const dependabotPath = path.resolve(rootDir, '.github/dependabot.yml');

  it('AC-6: .github/dependabot.yml exists and covers required ecosystems', () => {
    expect(fs.existsSync(dependabotPath)).toBe(true);
    const content = fs.readFileSync(dependabotPath, 'utf8');

    // Ecosystems
    expect(content).toMatch(/package-ecosystem:\s*["']?npm["']?/);
    expect(content).toMatch(/package-ecosystem:\s*["']?github-actions["']?/);
    expect(content).toMatch(/package-ecosystem:\s*["']?docker-compose["']?/);
    expect(content).not.toMatch(/package-ecosystem:\s*["']docker["']/);
  });

  it('AC-6: runs on a weekly schedule with grouped updates', () => {
    const content = fs.readFileSync(dependabotPath, 'utf8');

    expect(content).toMatch(/interval:\s*["']?weekly["']?/);
    expect(content).toContain('groups:');
    expect(content).toContain('patterns:');
  });

  it('AC-6: enforces a cooldown / minimum-release-age policy >= 3 days', () => {
    const content = fs.readFileSync(dependabotPath, 'utf8');

    // Cooldown days check (>= 3 days)
    const cooldownMatches = [...content.matchAll(/default-days:\s*(\d+)/g)];
    expect(cooldownMatches.length).toBeGreaterThanOrEqual(2);

    for (const match of cooldownMatches) {
      const rawDays = match[1] ?? '0';
      const days = parseInt(rawDays, 10);
      expect(days).toBeGreaterThanOrEqual(3);
    }
  });
});
