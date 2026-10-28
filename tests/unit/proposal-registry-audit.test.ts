import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getTimelineEventType,
  getAllTimelineEventTypes,
  resetTimelineRegistry,
} from '@/server/timeline/registry';
import { validateAndSanitizeMetadata, ACTION_METADATA_ALLOWLIST } from '@/server/audit/allowlist';
import { AuditMetadataValidationError } from '@/server/audit/types';

interface I18nCatalogue {
  clients?: {
    timeline?: {
      events?: {
        proposal_sent?: string;
        proposal_accepted?: string;
        proposal_declined?: string;
      };
    };
  };
}

describe('TASK-0058: Timeline Registry & Audit Allowlist (AC-8)', () => {
  beforeEach(() => {
    resetTimelineRegistry();
  });

  describe('AC-8: Timeline event registration', () => {
    it('AC-8: registers proposal.sent, proposal.accepted, and proposal.declined in default registry', () => {
      const types = getAllTimelineEventTypes().map((t) => t.type);
      expect(types).toContain('proposal.sent');
      expect(types).toContain('proposal.accepted');
      expect(types).toContain('proposal.declined');

      const sentEvent = getTimelineEventType('proposal.sent');
      expect(sentEvent).toBeDefined();
      expect(sentEvent?.dataKeys).toEqual(['proposal_id', 'total_minor', 'currency']);
      expect(sentEvent?.messageKey).toBe('clients.timeline.events.proposal_sent');

      const acceptedEvent = getTimelineEventType('proposal.accepted');
      expect(acceptedEvent).toBeDefined();
      expect(acceptedEvent?.dataKeys).toEqual(['proposal_id', 'total_minor', 'currency']);
      expect(acceptedEvent?.messageKey).toBe('clients.timeline.events.proposal_accepted');

      const declinedEvent = getTimelineEventType('proposal.declined');
      expect(declinedEvent).toBeDefined();
      expect(declinedEvent?.dataKeys).toEqual(['proposal_id', 'total_minor', 'currency']);
      expect(declinedEvent?.messageKey).toBe('clients.timeline.events.proposal_declined');
    });

    it('AC-8: ensures i18n keys for proposal timeline events exist in both en.json and de.json', () => {
      const rootDir = path.resolve(import.meta.dirname, '../..');
      const enPath = path.resolve(rootDir, 'messages/en.json');
      const dePath = path.resolve(rootDir, 'messages/de.json');

      const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as I18nCatalogue;
      const de = JSON.parse(fs.readFileSync(dePath, 'utf8')) as I18nCatalogue;

      const eventsEn = en.clients?.timeline?.events;
      const eventsDe = de.clients?.timeline?.events;

      expect(eventsEn?.proposal_sent).toBeDefined();
      expect(eventsEn?.proposal_accepted).toBeDefined();
      expect(eventsEn?.proposal_declined).toBeDefined();

      expect(eventsDe?.proposal_sent).toBeDefined();
      expect(eventsDe?.proposal_accepted).toBeDefined();
      expect(eventsDe?.proposal_declined).toBeDefined();
    });
  });

  describe('AC-8: Audit actions and metadata allowlist', () => {
    it('AC-8: registers all required proposal audit actions in ACTION_METADATA_ALLOWLIST', () => {
      expect(ACTION_METADATA_ALLOWLIST.has('proposal.created')).toBe(true);
      expect(ACTION_METADATA_ALLOWLIST.has('proposal.updated')).toBe(true);
      expect(ACTION_METADATA_ALLOWLIST.has('proposal.sent')).toBe(true);
      expect(ACTION_METADATA_ALLOWLIST.has('proposal.accepted')).toBe(true);
      expect(ACTION_METADATA_ALLOWLIST.has('proposal.declined')).toBe(true);
      expect(ACTION_METADATA_ALLOWLIST.has('proposal.revoked')).toBe(true);
    });

    it('AC-8: validates metadata allowlist for proposal actions in test environment', () => {
      const validMetadata = {
        proposal_id: '01920000-0000-7000-8000-000000000201',
        project_id: '01920000-0000-7000-8000-000000000071',
        client_id: '01920000-0000-7000-8000-000000000081',
        title: 'Emma Wedding Proposal',
        total_minor: 280000,
        currency: 'EUR',
        version: 1,
        status: 'draft',
      };

      const result = validateAndSanitizeMetadata('proposal.created', 'owner', validMetadata);
      expect(result).toEqual(validMetadata);

      // Disallowed key should throw in dev/test environment
      expect(() =>
        validateAndSanitizeMetadata('proposal.created', 'owner', {
          ...validMetadata,
          unauthorized_pii_field: 'secret_info',
        }),
      ).toThrow(AuditMetadataValidationError);
    });
  });
});
