import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('AC-9: Source scan for IP header usage', () => {
  const srcDir = path.resolve(import.meta.dirname, '../../src');

  function getAllFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getAllFiles(fullPath));
      } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('AC-9: asserts x-real-ip appears nowhere in src/ and x-forwarded-for appears only in src/server/http/client-ip.ts', () => {
    const allSourceFiles = getAllFiles(srcDir);
    expect(allSourceFiles.length).toBeGreaterThan(10);

    const filesWithRealIp: string[] = [];
    const filesWithForwardedFor: string[] = [];

    const expectedAllowedForwardedFor = path
      .resolve(srcDir, 'server/http/client-ip.ts')
      .toLowerCase();

    for (const filePath of allSourceFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lower = content.toLowerCase();

      if (lower.includes('x-real-ip')) {
        filesWithRealIp.push(path.relative(srcDir, filePath));
      }

      if (lower.includes('x-forwarded-for')) {
        const normalized = filePath.toLowerCase();
        if (normalized !== expectedAllowedForwardedFor) {
          filesWithForwardedFor.push(path.relative(srcDir, filePath));
        }
      }
    }

    expect(
      filesWithRealIp,
      `x-real-ip must appear nowhere in src/, but was found in: ${filesWithRealIp.join(', ')}`,
    ).toEqual([]);

    expect(
      filesWithForwardedFor,
      `x-forwarded-for must appear ONLY in src/server/http/client-ip.ts, but was found in: ${filesWithForwardedFor.join(', ')}`,
    ).toEqual([]);
  });
});
