import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('TASK-0024: Privacy Documentation Completeness', () => {
  const dataInventoryPath = path.resolve(
    import.meta.dirname,
    '../../docs/privacy/data-inventory.md',
  );

  it('AC-10: docs/privacy/data-inventory.md contains entries for inquiry_forms and inquiry_form_notice_versions', () => {
    expect(fs.existsSync(dataInventoryPath), 'data-inventory.md must exist').toBe(true);
    const content = fs.readFileSync(dataInventoryPath, 'utf8');

    expect(content).toContain('inquiry_forms');
    expect(content).toContain('inquiry_form_notice_versions');
    expect(content).toContain('created_by_actor_id');
    expect(content).toContain('pseudonymous owner UUID');
  });
});
