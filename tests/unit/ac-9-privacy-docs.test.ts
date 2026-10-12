import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TASK-0021: AC-9 Privacy & Sub-processor Documentation', () => {
  const subProcessorsPath = path.resolve(
    import.meta.dirname,
    '../../docs/privacy/sub-processors.md',
  );
  const dataInventoryPath = path.resolve(
    import.meta.dirname,
    '../../docs/privacy/data-inventory.md',
  );

  it('AC-9: projects/ownlight/docs/privacy/sub-processors.md exists with Google LLC listed as processor', () => {
    expect(fs.existsSync(subProcessorsPath), 'sub-processors.md must exist').toBe(true);
    const content = fs.readFileSync(subProcessorsPath, 'utf8');

    expect(content).toContain('Google LLC');
    expect(content).toContain('Art. 6(1)(f)');
    expect(content).toContain('EU-US Data Privacy Framework');
    expect(content).toContain('Standard Contractual Clauses');
    expect(content).toContain('Given name, family name, phone number(s)');
  });

  it('AC-9: projects/ownlight/docs/privacy/data-inventory.md contains entries for google_contacts_links and google_contacts_outbox', () => {
    expect(fs.existsSync(dataInventoryPath), 'data-inventory.md must exist').toBe(true);
    const content = fs.readFileSync(dataInventoryPath, 'utf8');

    expect(content).toContain('google_contacts_links');
    expect(content).toContain('google_contacts_outbox');
    expect(content).toContain('google_resource_name');
    expect(content).toContain('google_etag');
    expect(content).toContain('last_synced_at');
  });
});
