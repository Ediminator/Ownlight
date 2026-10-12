import { describe, it, expect } from 'vitest';
import {
  mapContactToGooglePerson,
  assertMinimisedPayload,
  FORBIDDEN_PEOPLE_FIELDS,
} from '@/server/integrations/google/mapping';

describe('TASK-0021: Google People API Payload Mapping & Data Minimisation (AC-3, AC-9)', () => {
  it('AC-3, AC-9: maps givenName, familyName, and phone to People API schema', () => {
    const contact = {
      id: '01a12000-0000-7000-8000-000000000001',
      clientId: '01a12000-0000-7000-8000-000000000002',
      givenName: 'Elena',
      familyName: 'Rostova',
      phone: '+49 170 1234567',
      email: 'elena@example.com',
      notes: 'VIP wedding client with special dietary requirements',
      postalAddress: 'Musterstraße 12, 10115 Berlin',
    };

    const payload = mapContactToGooglePerson(contact);

    expect(payload.names).toEqual([
      {
        givenName: 'Elena',
        familyName: 'Rostova',
      },
    ]);
    expect(payload.phoneNumbers).toEqual([
      {
        value: '+49 170 1234567',
        type: 'mobile',
      },
    ]);

    // Assert that emails, notes, addresses, and internal IDs are completely absent
    const rawRecord = payload as unknown as Record<string, unknown>;
    expect(rawRecord).not.toHaveProperty('email');
    expect(rawRecord).not.toHaveProperty('emailAddresses');
    expect(rawRecord).not.toHaveProperty('notes');
    expect(rawRecord).not.toHaveProperty('biographies');
    expect(rawRecord).not.toHaveProperty('addresses');
    expect(rawRecord).not.toHaveProperty('postalAddress');
    expect(rawRecord).not.toHaveProperty('id');
    expect(rawRecord).not.toHaveProperty('clientId');
    expect(rawRecord).not.toHaveProperty('contactId');

    // Also assert using assertMinimisedPayload
    expect(() => {
      assertMinimisedPayload(rawRecord);
    }).not.toThrow();
  });

  it('AC-3: includes etag when provided for optimistic concurrency updates', () => {
    const contact = {
      givenName: 'Marcus',
      familyName: 'Vogel',
      phone: '+49 171 9876543',
    };

    const payload = mapContactToGooglePerson(contact, '%EtagValue123=');
    expect(payload.etag).toBe('%EtagValue123=');
    expect(payload.names[0]?.givenName).toBe('Marcus');
  });

  it('AC-9: trims whitespace from names and phone number', () => {
    const contact = {
      givenName: '  Sarah  ',
      familyName: '  Connor  ',
      phone: '  +49 30 123456  ',
    };

    const payload = mapContactToGooglePerson(contact);
    expect(payload.names[0]).toEqual({
      givenName: 'Sarah',
      familyName: 'Connor',
    });
    expect(payload.phoneNumbers?.[0]?.value).toBe('+49 30 123456');
  });

  it('AC-9: omits phoneNumbers if phone is missing or whitespace-only', () => {
    const contact = {
      givenName: 'Thomas',
      familyName: 'Müller',
      phone: '   ',
    };

    const payload = mapContactToGooglePerson(contact);
    expect(payload.phoneNumbers).toBeUndefined();
  });

  it('AC-9: handles contact with only givenName or only familyName', () => {
    const contactOnlyGiven = { givenName: 'Madonna', familyName: null };
    const payload1 = mapContactToGooglePerson(contactOnlyGiven);
    expect(payload1.names).toEqual([{ givenName: 'Madonna' }]);

    const contactOnlyFamily = { givenName: undefined, familyName: 'Cher' };
    const payload2 = mapContactToGooglePerson(contactOnlyFamily);
    expect(payload2.names).toEqual([{ familyName: 'Cher' }]);
  });

  it('AC-9: assertMinimisedPayload throws when a prohibited field is present', () => {
    for (const forbidden of FORBIDDEN_PEOPLE_FIELDS) {
      const taintedPayload = {
        names: [{ givenName: 'Test' }],
        [forbidden]: 'leaked_data',
      };
      expect(() => {
        assertMinimisedPayload(taintedPayload);
      }).toThrow(/Data minimisation violation/);
    }
  });
});
