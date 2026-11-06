import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('server-only', () => ({}));
import { getTimelineEventType } from '@/server/timeline/registry';
import { ACTION_METADATA_ALLOWLIST } from '@/server/audit/allowlist';

describe('Contracts Registry, Audit Allowlist & ADR-0019 Unit Tests (AC-9, AC-10)', () => {
  it('AC-9: timeline registry defines contract.sent event type with expected dataKeys', () => {
    const event = getTimelineEventType('contract.sent');
    expect(event).toBeDefined();
    expect(event?.dataKeys).toEqual(['contract_id', 'contract_number']);
    expect(event?.messageKey).toBe('clients.timeline.events.contract_sent');
  });

  it('AC-9: timeline registry defines contract.signed_by_client event type with expected dataKeys', () => {
    const event = getTimelineEventType('contract.signed_by_client');
    expect(event).toBeDefined();
    expect(event?.dataKeys).toEqual(['contract_id', 'contract_number', 'signer_name']);
    expect(event?.messageKey).toBe('clients.timeline.events.contract_signed_by_client');
  });

  it('AC-9: timeline registry defines contract.countersigned event type with expected dataKeys', () => {
    const event = getTimelineEventType('contract.countersigned');
    expect(event).toBeDefined();
    expect(event?.dataKeys).toEqual(['contract_id', 'contract_number']);
    expect(event?.messageKey).toBe('clients.timeline.events.contract_countersigned');
  });

  it('AC-9: timeline registry defines contract.voided event type with expected dataKeys', () => {
    const event = getTimelineEventType('contract.voided');
    expect(event).toBeDefined();
    expect(event?.dataKeys).toEqual(['contract_id', 'contract_number']);
    expect(event?.messageKey).toBe('clients.timeline.events.contract_voided');
  });

  it('AC-9: messages/en.json and messages/de.json contain all contract timeline event message keys', () => {
    const enPath = path.resolve(process.cwd(), 'messages/en.json');
    const dePath = path.resolve(process.cwd(), 'messages/de.json');

    interface MessagesStructure {
      clients?: {
        timeline?: {
          events?: Record<string, string>;
        };
      };
    }

    const enJson = JSON.parse(fs.readFileSync(enPath, 'utf8')) as MessagesStructure;
    const deJson = JSON.parse(fs.readFileSync(dePath, 'utf8')) as MessagesStructure;

    const requiredKeys = [
      'contract_sent',
      'contract_signed_by_client',
      'contract_countersigned',
      'contract_voided',
    ];

    const enEvents = new Map(Object.entries(enJson.clients?.timeline?.events ?? {}));
    const deEvents = new Map(Object.entries(deJson.clients?.timeline?.events ?? {}));

    for (const key of requiredKeys) {
      expect(enEvents.has(key)).toBe(true);
      expect(typeof enEvents.get(key)).toBe('string');
      expect(deEvents.has(key)).toBe(true);
      expect(typeof deEvents.get(key)).toBe('string');
    }
  });

  it('AC-9: audit allowlist registers all 12 contract actions with allowed metadata keys', () => {
    const expectedActions = [
      'contract_template.created',
      'contract_template.updated',
      'contract_template.deleted',
      'contract.created',
      'contract.updated',
      'contract.sent',
      'contract.signed_by_client',
      'contract.countersigned',
      'contract.voided',
      'contract.revoked',
      'contract.reminded',
      'studio_settings.contract_updated',
    ];

    for (const action of expectedActions) {
      const allowed = ACTION_METADATA_ALLOWLIST.get(action);
      expect(allowed, `Action ${action} should be registered in allowlist`).toBeDefined();
      expect(allowed?.length).toBeGreaterThan(0);
    }

    // Verify key fields for template actions
    const tplCreated = ACTION_METADATA_ALLOWLIST.get('contract_template.created');
    expect(tplCreated).toContain('template_id');
    expect(tplCreated).toContain('slug');
    expect(tplCreated).toContain('name');

    // Verify key fields for contract actions
    const ctrCreated = ACTION_METADATA_ALLOWLIST.get('contract.created');
    expect(ctrCreated).toContain('contract_id');
    expect(ctrCreated).toContain('project_id');
    expect(ctrCreated).toContain('client_id');
    expect(ctrCreated).toContain('contract_number');

    // Verify studio settings contract update action contains only non-PII keys (I1-S01)
    const studioContract = ACTION_METADATA_ALLOWLIST.get('studio_settings.contract_updated');
    expect(studioContract).toContain('changed_fields');
    expect(studioContract).toContain('contract_countersignature_mode');
    expect(studioContract).toContain('studio_country_code');
    expect(studioContract).not.toContain('contract_signatory_name');
    expect(studioContract).not.toContain('contract_signatory_title');
    expect(studioContract).not.toContain('studio_city');
    expect(studioContract).not.toContain('studio_address_line1');
    expect(studioContract).not.toContain('studio_address_line2');
    expect(studioContract).not.toContain('studio_postal_code');
    expect(studioContract).not.toContain('studio_phone');
    expect(studioContract).not.toContain('studio_email');

    // Verify signing actions do NOT contain signer_name (I1-S04)
    const clientSigned = ACTION_METADATA_ALLOWLIST.get('contract.signed_by_client');
    expect(clientSigned).toContain('signature_type');
    expect(clientSigned).not.toContain('signer_name');

    const countersigned = ACTION_METADATA_ALLOWLIST.get('contract.countersigned');
    expect(countersigned).not.toContain('signer_name');
  });

  it('I1-S02: data inventory registers all personal data fields for contracts and studio signatory profile', () => {
    const inventoryPath = path.resolve(process.cwd(), 'docs/privacy/data-inventory.md');
    const content = fs.readFileSync(inventoryPath, 'utf8');

    const requiredContractFields = [
      'contracts.client_signer_name',
      'contracts.client_signer_email',
      'contracts.client_signature_type',
      'contracts.client_signature_data',
      'contracts.client_ip_anonymized',
      'contracts.client_user_agent',
      'contracts.studio_signer_name',
      'contracts.studio_signer_title',
      'contracts.studio_signature_data',
      'contracts.rendered_body',
      'contracts.merge_values_snapshot',
      'contracts.internal_notes',
    ];

    for (const field of requiredContractFields) {
      expect(content).toContain(`\`${field}\``);
    }

    const requiredStudioFields = [
      'studio_settings.contract_signatory_name',
      'studio_settings.contract_signatory_title',
      'studio_settings.contract_countersignature_mode',
      'studio_settings.studio_address_line1',
      'studio_settings.studio_address_line2',
      'studio_settings.studio_postal_code',
      'studio_settings.studio_city',
      'studio_settings.studio_country_code',
      'studio_settings.studio_phone',
      'studio_settings.studio_email',
    ];

    for (const field of requiredStudioFields) {
      expect(content).toContain(`\`${field}\``);
    }

    // Verify statutory retention basis is referenced
    expect(content).toContain('10-year statutory retention');
    expect(content).toContain('§147 AO');
    expect(content).toContain('§257 HGB');
  });

  it('AC-10: ADR-0019 exists in projects/ownlight/docs/architecture/adr/ and specifies status Accepted (2026-11-06)', () => {
    const adrPath = path.resolve(
      process.cwd(),
      'docs/architecture/adr/0019-contracts-and-e-signature.md',
    );
    expect(fs.existsSync(adrPath), `ADR file should exist at ${adrPath}`).toBe(true);

    const content = fs.readFileSync(adrPath, 'utf8');
    expect(content).toContain('ADR-0019: Contracts and e-signature');
    expect(content).toMatch(/Status:\s*Accepted\s*\(2026-11-06\)/);
  });
});
