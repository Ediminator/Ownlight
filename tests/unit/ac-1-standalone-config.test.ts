import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import nextConfig from '../../next.config.mjs';

describe('AC-1: Next.js Standalone Configuration', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const nextConfigPath = path.resolve(rootDir, 'next.config.mjs');

  it('AC-1: next.config.mjs exists and sets output to standalone', () => {
    expect(fs.existsSync(nextConfigPath)).toBe(true);
    const content = fs.readFileSync(nextConfigPath, 'utf8');
    expect(content).toMatch(/output:\s*['"]standalone['"]/);

    interface ConfigWithOutput {
      output?: string;
    }

    const config = nextConfig as ConfigWithOutput | (() => ConfigWithOutput);
    const resolvedConfig = typeof config === 'function' ? config() : config;

    expect(resolvedConfig.output).toBe('standalone');
  });
});
