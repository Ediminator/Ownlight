import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TASK-0056: Synology Compose Parity and ADR-0018 Verification', () => {
  const rootDir = path.resolve(import.meta.dirname, '../..');
  const synologyComposePath = path.resolve(rootDir, 'compose.synology.yml');
  const adr0018Path = path.resolve(
    rootDir,
    'docs/architecture/adr/0018-packages-quotes-and-proposals.md',
  );

  it('AC-9: compose.synology.yml supplies SMTP_FROM fallback expression in web and worker services', () => {
    expect(fs.existsSync(synologyComposePath)).toBe(true);
    const content = fs.readFileSync(synologyComposePath, 'utf8');

    // Split web and worker sections
    const webSection = content.split(/web:\s*\n/)[1]?.split(/\n\s{2}[a-z0-9_-]+:\s*\n/)[0] ?? '';
    const workerSection =
      content.split(/worker:\s*\n/)[1]?.split(/\n\s{2}[a-z0-9_-]+:\s*\n/)[0] ?? '';

    expect(webSection).toMatch(
      /SMTP_FROM:\s*['"]\$\{SMTP_FROM:-\$\{EMAIL_FROM:-noreply@example\.com\}\}['"]/,
    );
    expect(workerSection).toMatch(
      /SMTP_FROM:\s*['"]\$\{SMTP_FROM:-\$\{EMAIL_FROM:-noreply@example\.com\}\}['"]/,
    );
  });

  it('AC-9: compose.synology.yml defines storage keys without hardcoded fallback credentials', () => {
    const content = fs.readFileSync(synologyComposePath, 'utf8');
    expect(content).toMatch(
      /STORAGE_ACCESS_KEY:\s*['"]\$\{STORAGE_ACCESS_KEY:\?STORAGE_ACCESS_KEY is required\}['"]/,
    );
    expect(content).toMatch(
      /STORAGE_SECRET_KEY:\s*['"]\$\{STORAGE_SECRET_KEY:\?STORAGE_SECRET_KEY is required\}['"]/,
    );
  });

  it('AC-10: docs/architecture/adr/0018-packages-quotes-and-proposals.md exists and specifies status Accepted (2026-10-27)', () => {
    expect(fs.existsSync(adr0018Path)).toBe(true);
    const adrContent = fs.readFileSync(adr0018Path, 'utf8');
    expect(adrContent).toMatch(/- Status:\s*Accepted\s*\(2026-10-27\)/);
  });
});
