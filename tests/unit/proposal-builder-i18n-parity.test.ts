import { describe, it, expect } from 'vitest';
import enMessages from '@/../messages/en.json';
import deMessages from '@/../messages/de.json';

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = Reflect.get(current, part);
    } else {
      return undefined;
    }
  }
  return current;
}

function extractAllKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...extractAllKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

describe('TASK-0061 / AC-7: Proposal Builder i18n parity', () => {
  it('AC-7: all proposals.builder keys exist in both en.json and de.json with non-empty translations', () => {
    const enRecord = enMessages as { proposals?: { builder?: Record<string, unknown> } };
    const deRecord = deMessages as { proposals?: { builder?: Record<string, unknown> } };

    const enProposals = enRecord.proposals;
    const deProposals = deRecord.proposals;

    expect(enProposals).toBeDefined();
    expect(deProposals).toBeDefined();

    const enBuilder = enProposals?.builder ?? {};
    const deBuilder = deProposals?.builder ?? {};

    const enKeys = extractAllKeys(enBuilder, 'proposals.builder');
    const deKeys = extractAllKeys(deBuilder, 'proposals.builder');

    expect(enKeys.length).toBeGreaterThan(20);
    expect(deKeys.length).toBeGreaterThan(20);

    for (const key of enKeys) {
      const enVal = getNestedValue(enMessages, key);
      const deVal = getNestedValue(deMessages, key);

      expect(typeof enVal).toBe('string');
      expect(typeof enVal === 'string' && enVal.trim().length > 0).toBe(true);

      expect(typeof deVal).toBe('string');
      expect(typeof deVal === 'string' && deVal.trim().length > 0).toBe(true);
    }

    expect(new Set(enKeys)).toEqual(new Set(deKeys));
  });
});
