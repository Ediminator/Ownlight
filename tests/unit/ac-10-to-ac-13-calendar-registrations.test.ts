import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getTimelineEventType,
  getAllTimelineEventTypes,
  resetTimelineRegistry,
} from '@/server/timeline/registry';
import { recordTimelineEvent } from '@/server/timeline/service';
import type { DbClient } from '@/server/db/client';
import { validateAndSanitizeMetadata } from '@/server/audit/allowlist';
import { AuditMetadataValidationError } from '@/server/audit/types';

interface I18nCatalogue {
  clients?: {
    timeline?: {
      events?: {
        appointment_scheduled?: string;
        appointment_cancelled?: string;
      };
    };
  };
}

describe('TASK-0040: Calendar Registrations, Audit, Timeline, ADR, and i18n (AC-10 to AC-13)', () => {
  beforeEach(() => {
    resetTimelineRegistry();
  });

  // AC-10
  describe('AC-10: Audit metadata allowlist for calendar actions', () => {
    const calendarActions = [
      {
        action: 'booking_type.created',
        valid: {
          booking_type_id: '01920000-0000-7000-8000-000000000001',
          slug: 'discovery-call',
          duration_minutes: 30,
        },
        invalidKey: 'private_notes',
      },
      {
        action: 'booking_type.updated',
        valid: {
          booking_type_id: '01920000-0000-7000-8000-000000000001',
          changed_fields: ['title', 'durationMinutes'],
        },
        invalidKey: 'secret_token',
      },
      {
        action: 'booking_type.deleted',
        valid: {
          booking_type_id: '01920000-0000-7000-8000-000000000001',
        },
        invalidKey: 'slug',
      },
      {
        action: 'appointment.created',
        valid: {
          appointment_id: '01920000-0000-7000-8000-000000000002',
          booking_type_id: '01920000-0000-7000-8000-000000000001',
          starts_at: '2026-10-26T09:00:00.000Z',
          location_type: 'google_meet',
          client_id: '01920000-0000-7000-8000-000000000003',
          lead_id: '01920000-0000-7000-8000-000000000004',
        },
        invalidKey: 'attendee_email', // PII must be rejected!
      },
      {
        action: 'appointment.updated',
        valid: {
          appointment_id: '01920000-0000-7000-8000-000000000002',
          changed_fields: ['location_type', 'starts_at'],
        },
        invalidKey: 'attendee_phone',
      },
      {
        action: 'appointment.cancelled',
        valid: {
          appointment_id: '01920000-0000-7000-8000-000000000002',
          reason: 'Client requested reschedule',
        },
        invalidKey: 'attendee_name',
      },
      {
        action: 'blocked_time.created',
        valid: {
          blocked_time_id: '01920000-0000-7000-8000-000000000005',
          starts_at: '2026-10-26T09:00:00.000Z',
          ends_at: '2026-10-26T17:00:00.000Z',
          all_day: true,
        },
        invalidKey: 'personal_details',
      },
      {
        action: 'blocked_time.updated',
        valid: {
          blocked_time_id: '01920000-0000-7000-8000-000000000005',
          changed_fields: ['title', 'starts_at'],
        },
        invalidKey: 'location',
      },
      {
        action: 'blocked_time.deleted',
        valid: {
          blocked_time_id: '01920000-0000-7000-8000-000000000005',
        },
        invalidKey: 'notes',
      },
      {
        action: 'availability.updated',
        valid: {
          schedule_count: 7,
          override_count: 2,
        },
        invalidKey: 'calendar_name',
      },
      {
        action: 'calendar_feed.created',
        valid: {
          feed_id: '01920000-0000-7000-8000-000000000006',
          summary_level: 'standard',
        },
        invalidKey: 'raw_token', // Never log secret token!
      },
      {
        action: 'calendar_feed.revoked',
        valid: {
          feed_id: '01920000-0000-7000-8000-000000000006',
        },
        invalidKey: 'user_agent',
      },
      {
        action: 'integration.caldav.connected',
        valid: {
          account_id: 'caldav-account-id-001',
          server_url: 'https://caldav.example.com',
          calendar_name: 'Studio',
        },
        invalidKey: 'password', // Password must never be logged!
      },
      {
        action: 'integration.caldav.disconnected',
        valid: {
          account_id: 'caldav-account-id-001',
        },
        invalidKey: 'auth_token',
      },
      {
        action: 'calendar_sync.executed',
        valid: {
          provider: 'google',
          synced_count: 12,
          failed_count: 0,
          duration_ms: 450,
        },
        invalidKey: 'event_payload',
      },
    ];

    for (const { action, valid, invalidKey } of calendarActions) {
      it(`AC-10: permits allowed metadata for ${action}`, () => {
        const sanitized = validateAndSanitizeMetadata(action, 'owner', valid);
        expect(sanitized).toEqual(valid);
      });

      it(`AC-10: rejects unpermitted metadata key "${invalidKey}" for ${action} in test/dev`, () => {
        expect(() =>
          validateAndSanitizeMetadata(action, 'owner', {
            ...valid,
            [invalidKey]: 'unauthorized_data',
          }),
        ).toThrow(AuditMetadataValidationError);
      });
    }
  });

  // AC-11
  describe('AC-11: Timeline Registry & Event Recording for Appointments', () => {
    it('AC-11: registers appointment.scheduled and appointment.cancelled with zero-PII dataKeys in default registry', () => {
      const types = getAllTimelineEventTypes().map((t) => t.type);
      expect(types).toContain('appointment.scheduled');
      expect(types).toContain('appointment.cancelled');

      const scheduled = getTimelineEventType('appointment.scheduled');
      expect(scheduled).toBeDefined();
      expect(scheduled?.dataKeys).toEqual(['appointment_id', 'starts_at', 'location_type']);
      expect(scheduled?.messageKey).toBe('clients.timeline.events.appointment_scheduled');

      const cancelled = getTimelineEventType('appointment.cancelled');
      expect(cancelled).toBeDefined();
      expect(cancelled?.dataKeys).toEqual(['appointment_id', 'reason']);
      expect(cancelled?.messageKey).toBe('clients.timeline.events.appointment_cancelled');
    });

    it('AC-11: recordTimelineEvent accepts valid appointment.scheduled event with allowed data keys', async () => {
      let insertedVals: { data?: Record<string, unknown> } | undefined;
      const fakeTx = {
        insert: () => ({
          values: (vals: { data?: Record<string, unknown> }) => {
            insertedVals = vals;
            return {
              returning: () =>
                Promise.resolve([{ id: '01920000-0000-7000-8000-000000000099', ...vals }]),
            };
          },
        }),
      } as unknown as DbClient;

      const event = await recordTimelineEvent(fakeTx, {
        clientId: '01920000-0000-7000-8000-000000000001',
        type: 'appointment.scheduled',
        actorType: 'owner',
        actorId: '01920000-0000-7000-8000-000000000002',
        subjectType: 'appointment',
        subjectId: '01920000-0000-7000-8000-000000000003',
        data: {
          appointment_id: '01920000-0000-7000-8000-000000000003',
          starts_at: '2026-10-26T10:00:00.000Z',
          location_type: 'google_meet',
        },
      });

      expect(event).toBeDefined();
      expect(insertedVals?.data).toEqual({
        appointment_id: '01920000-0000-7000-8000-000000000003',
        starts_at: '2026-10-26T10:00:00.000Z',
        location_type: 'google_meet',
      });
    });

    it('AC-11: recordTimelineEvent rejects PII data keys in appointment.scheduled in test environment', async () => {
      const fakeTx = {
        insert: () => ({
          values: () => ({
            returning: () => Promise.resolve([]),
          }),
        }),
      } as unknown as DbClient;

      await expect(
        recordTimelineEvent(fakeTx, {
          clientId: '01920000-0000-7000-8000-000000000001',
          type: 'appointment.scheduled',
          actorType: 'owner',
          actorId: '01920000-0000-7000-8000-000000000002',
          data: {
            appointment_id: '01920000-0000-7000-8000-000000000003',
            attendee_email: 'client@example.com', // PII violation!
          },
        }),
      ).rejects.toThrow();
    });
  });

  // AC-12
  describe('AC-12: ADR-0017 Architectural Decision Record Status', () => {
    it('AC-12: docs/architecture/adr/0017-calendar-and-booking-scheduler.md exists with status Accepted', () => {
      const adrPath = path.resolve(
        process.cwd(),
        'docs/architecture/adr/0017-calendar-and-booking-scheduler.md',
      );
      expect(fs.existsSync(adrPath)).toBe(true);

      const content = fs.readFileSync(adrPath, 'utf8');
      expect(content).toMatch(/Status:\s*Accepted/i);
    });
  });

  // AC-13
  describe('AC-13: Timeline Event Message Translations (en and de)', () => {
    it('AC-13: messages/en.json and messages/de.json contain appointment timeline event strings', () => {
      const enPath = path.resolve(process.cwd(), 'messages/en.json');
      const dePath = path.resolve(process.cwd(), 'messages/de.json');

      expect(fs.existsSync(enPath)).toBe(true);
      expect(fs.existsSync(dePath)).toBe(true);

      const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as I18nCatalogue;
      const de = JSON.parse(fs.readFileSync(dePath, 'utf8')) as I18nCatalogue;

      const enEvents = en.clients?.timeline?.events;
      const deEvents = de.clients?.timeline?.events;

      expect(enEvents?.appointment_scheduled).toBe('Appointment scheduled');
      expect(enEvents?.appointment_cancelled).toBe('Appointment cancelled');

      expect(deEvents?.appointment_scheduled).toBe('Termin vereinbart');
      expect(deEvents?.appointment_cancelled).toBe('Termin abgesagt');
    });
  });

  // I1-S01 (GDPR Art. 30 Data Inventory)
  describe('I1-S01: Appointments Personal Data Inventory', () => {
    it('I1-S01: docs/privacy/data-inventory.md documents appointments table personal data fields', () => {
      const inventoryPath = path.resolve(process.cwd(), 'docs/privacy/data-inventory.md');
      expect(fs.existsSync(inventoryPath)).toBe(true);

      const content = fs.readFileSync(inventoryPath, 'utf8');
      expect(content).toContain('appointments.attendee_name');
      expect(content).toContain('appointments.attendee_email');
      expect(content).toContain('appointments.attendee_phone');
      expect(content).toContain('appointments.attendee_notes');
    });
  });
});
