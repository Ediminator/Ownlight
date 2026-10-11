import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { generateJsonExport } from '@/server/privacy/export/json';
import { dsarExportSchema } from '@/server/privacy/export/schema';
import type { ExportCollectedData } from '@/server/privacy/export/types';

describe('TASK-0015: DSAR JSON export generator (AC-1)', () => {
  const sampleExportData: ExportCollectedData = {
    schema: 'ownlight.dsar.v1',
    generated_at: '2026-10-11T12:00:00.000Z',
    studio: {
      name: 'Lumière Photo Studio',
    },
    subject: {
      id: 'c0000000-0000-4000-8000-000000000001',
      display_name: 'Jane Doe',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@example.com',
      phone: '+49 151 12345678',
      role: 'primary',
      created_at: '2026-01-15T09:30:00.000Z',
      updated_at: '2026-03-20T14:15:00.000Z',
    },
    categories: {
      client: [
        {
          display_name: 'Jane Doe',
          kind: 'person',
          preferred_language: 'en',
          created_at: '2026-01-15T09:30:00.000Z',
          last_activity_at: '2026-03-20T14:15:00.000Z',
        },
      ],
      addresses: [
        {
          type: 'postal',
          street: 'Musterstraße 42',
          postal_code: '10115',
          city: 'Berlin',
          country: 'DE',
        },
      ],
      tags: [{ name: 'wedding' }, { name: 'portrait' }],
      notes: [
        {
          id: 'n0000000-0000-4000-8000-000000000001',
          body: 'Client prefers outdoor natural lighting.',
          created_at: '2026-02-01T10:00:00.000Z',
        },
      ],
      timeline: [
        {
          type: 'client.created',
          occurred_at: '2026-01-15T09:30:00.000Z',
          actor_type: 'user',
          data: {},
        },
      ],
      consents: [
        {
          purpose: 'marketing',
          status: 'granted',
          effective_on: '2026-01-15',
          method: 'form',
          scope: null,
        },
      ],
      audit: [
        {
          action: 'client.updated',
          occurred_at: '2026-03-20T14:15:00.000Z',
          outcome: 'success',
        },
      ],
    },
  };

  it('AC-1: generates JSON matching the ownlight.dsar.v1 zod schema', () => {
    const jsonOutput = generateJsonExport(sampleExportData);
    expect(typeof jsonOutput).toBe('string');

    const parsed = JSON.parse(jsonOutput) as unknown;
    const validation = dsarExportSchema.safeParse(parsed);

    expect(validation.success).toBe(true);
    if (!validation.success) {
      throw new Error(`Validation failed: ${JSON.stringify(validation.error.issues)}`);
    }

    expect(validation.data.schema).toBe('ownlight.dsar.v1');
    expect(validation.data.studio.name).toBe('Lumière Photo Studio');
    expect(validation.data.subject.id).toBe('c0000000-0000-4000-8000-000000000001');
    expect(validation.data.subject.email).toBe('jane@example.com');
  });

  it('AC-1: rejects data with missing required top-level fields', () => {
    const invalidData = {
      schema: 'ownlight.dsar.v1',
      // missing generated_at, studio, subject
      categories: {},
    };

    const validation = dsarExportSchema.safeParse(invalidData);
    expect(validation.success).toBe(false);
  });

  it('AC-1: rejects data with an incorrect schema identifier', () => {
    const invalidSchemaData = {
      ...sampleExportData,
      schema: 'ownlight.dsar.v2',
    };

    const validation = dsarExportSchema.safeParse(invalidSchemaData);
    expect(validation.success).toBe(false);
  });
});
