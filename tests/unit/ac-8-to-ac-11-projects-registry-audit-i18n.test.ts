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
        project_created?: string;
        project_stage_changed?: string;
        shoot_scheduled?: string;
      };
    };
  };
}

describe('TASK-0033: Projects & Pipeline Timeline, Audit, ADR, and i18n (AC-8 to AC-11)', () => {
  beforeEach(() => {
    resetTimelineRegistry();
  });

  // AC-8
  describe('AC-8: Timeline Registry & Event Recording for Projects and Shoots', () => {
    it('AC-8: registers project.created, project.stage_changed, and shoot.scheduled with zero-PII dataKeys in default registry', () => {
      const types = getAllTimelineEventTypes().map((t) => t.type);
      expect(types).toContain('project.created');
      expect(types).toContain('project.stage_changed');
      expect(types).toContain('shoot.scheduled');

      const projectCreated = getTimelineEventType('project.created');
      expect(projectCreated).toBeDefined();
      expect(projectCreated?.dataKeys).toEqual(['project_id', 'project_type']);
      expect(projectCreated?.messageKey).toBe('clients.timeline.events.project_created');

      const stageChanged = getTimelineEventType('project.stage_changed');
      expect(stageChanged).toBeDefined();
      expect(stageChanged?.dataKeys).toEqual(['project_id', 'from_stage', 'to_stage']);
      expect(stageChanged?.messageKey).toBe('clients.timeline.events.project_stage_changed');

      const shootScheduled = getTimelineEventType('shoot.scheduled');
      expect(shootScheduled).toBeDefined();
      expect(shootScheduled?.dataKeys).toEqual(['project_id', 'shoot_id', 'starts_at']);
      expect(shootScheduled?.messageKey).toBe('clients.timeline.events.shoot_scheduled');
    });

    it('AC-8: recordTimelineEvent accepts valid project and shoot timeline events with allowed data keys', async () => {
      let insertedVals: { data?: Record<string, unknown> } | undefined;
      const fakeTx = {
        insert: () => ({
          values: (vals: { data?: Record<string, unknown> }) => {
            insertedVals = vals;
            return {
              returning: () => Promise.resolve([vals]),
            };
          },
        }),
      } as unknown as DbClient;

      const result1 = await recordTimelineEvent(fakeTx, {
        clientId: '018f0000-0000-7000-8000-000000000001',
        type: 'project.created',
        actorType: 'owner',
        data: {
          project_id: '01920000-0000-7000-8000-000000000101',
          project_type: 'wedding',
        },
      });

      expect(result1).toBeDefined();
      expect(insertedVals?.data).toEqual({
        project_id: '01920000-0000-7000-8000-000000000101',
        project_type: 'wedding',
      });

      const result2 = await recordTimelineEvent(fakeTx, {
        clientId: '018f0000-0000-7000-8000-000000000001',
        type: 'project.stage_changed',
        actorType: 'owner',
        data: {
          project_id: '01920000-0000-7000-8000-000000000101',
          from_stage: 'inquiry',
          to_stage: 'booked',
        },
      });

      expect(result2).toBeDefined();
      expect(insertedVals?.data).toEqual({
        project_id: '01920000-0000-7000-8000-000000000101',
        from_stage: 'inquiry',
        to_stage: 'booked',
      });

      const result3 = await recordTimelineEvent(fakeTx, {
        clientId: '018f0000-0000-7000-8000-000000000001',
        type: 'shoot.scheduled',
        actorType: 'owner',
        data: {
          project_id: '01920000-0000-7000-8000-000000000101',
          shoot_id: '01920000-0000-7000-8000-000000000201',
          starts_at: '2027-06-15T10:00:00Z',
        },
      });

      expect(result3).toBeDefined();
      expect(insertedVals?.data).toEqual({
        project_id: '01920000-0000-7000-8000-000000000101',
        shoot_id: '01920000-0000-7000-8000-000000000201',
        starts_at: '2027-06-15T10:00:00Z',
      });
    });

    it('AC-8: recordTimelineEvent rejects disallowed keys for project and shoot events in test environment', async () => {
      const fakeTx = {} as unknown as DbClient;

      await expect(
        recordTimelineEvent(fakeTx, {
          clientId: '018f0000-0000-7000-8000-000000000001',
          type: 'project.created',
          actorType: 'owner',
          data: {
            project_id: '01920000-0000-7000-8000-000000000101',
            client_name: 'Forbidden PII Name',
          },
        }),
      ).rejects.toThrow(/Timeline event key 'client_name' not allowed for type 'project\.created'/);

      await expect(
        recordTimelineEvent(fakeTx, {
          clientId: '018f0000-0000-7000-8000-000000000001',
          type: 'shoot.scheduled',
          actorType: 'owner',
          data: {
            project_id: '01920000-0000-7000-8000-000000000101',
            venue_address: 'Forbidden Address PII',
          },
        }),
      ).rejects.toThrow(
        /Timeline event key 'venue_address' not allowed for type 'shoot\.scheduled'/,
      );
    });
  });

  // AC-9
  describe('AC-9: Audit Allowlist Validation for Project and Shoot Actions', () => {
    it('AC-9: allows all registered metadata keys for project actions', () => {
      // project.created
      const createdMeta = validateAndSanitizeMetadata('project.created', 'owner', {
        project_id: '01920000-0000-7000-8000-000000000101',
        client_id: '018f0000-0000-7000-8000-000000000001',
        project_type: 'wedding',
        stage_id: '01920000-0000-7000-8000-000000000001',
        lead_id: '018f0000-0000-7000-8000-000000000099',
      });
      expect(createdMeta).toBeDefined();
      expect(createdMeta?.project_id).toBe('01920000-0000-7000-8000-000000000101');

      // project.updated
      const updatedMeta = validateAndSanitizeMetadata('project.updated', 'owner', {
        project_id: '01920000-0000-7000-8000-000000000101',
        changed_fields: ['title', 'notes'],
      });
      expect(updatedMeta).toBeDefined();

      // project.stage_changed
      const stageMeta = validateAndSanitizeMetadata('project.stage_changed', 'owner', {
        project_id: '01920000-0000-7000-8000-000000000101',
        from_stage_id: '01920000-0000-7000-8000-000000000001',
        to_stage_id: '01920000-0000-7000-8000-000000000002',
        from_stage: 'inquiry',
        to_stage: 'booked',
      });
      expect(stageMeta).toBeDefined();

      // project.deleted
      const deletedMeta = validateAndSanitizeMetadata('project.deleted', 'owner', {
        project_id: '01920000-0000-7000-8000-000000000001',
        client_id: '018f0000-0000-7000-8000-000000000001',
      });
      expect(deletedMeta).toBeDefined();

      // shoot.created
      const shootCreatedMeta = validateAndSanitizeMetadata('shoot.created', 'owner', {
        shoot_id: '01920000-0000-7000-8000-000000000201',
        project_id: '01920000-0000-7000-8000-000000000101',
        starts_at: '2027-06-15T10:00:00Z',
      });
      expect(shootCreatedMeta).toBeDefined();

      // shoot.updated
      const shootUpdatedMeta = validateAndSanitizeMetadata('shoot.updated', 'owner', {
        shoot_id: '01920000-0000-7000-8000-000000000201',
        project_id: '01920000-0000-7000-8000-000000000101',
        changed_fields: ['title', 'starts_at'],
      });
      expect(shootUpdatedMeta).toBeDefined();

      // shoot.deleted
      const shootDeletedMeta = validateAndSanitizeMetadata('shoot.deleted', 'owner', {
        shoot_id: '01920000-0000-7000-8000-000000000201',
        project_id: '01920000-0000-7000-8000-000000000101',
      });
      expect(shootDeletedMeta).toBeDefined();

      // stage_config.updated
      const stageConfigMeta = validateAndSanitizeMetadata('stage_config.updated', 'owner', {
        stage_count: 6,
        changed_stages: ['inquiry', 'booked'],
      });
      expect(stageConfigMeta).toBeDefined();
    });

    it('AC-9: throws AuditMetadataValidationError on unauthorized keys in test environment', () => {
      expect(() => {
        validateAndSanitizeMetadata('project.created', 'owner', {
          project_id: '01920000-0000-7000-8000-000000000101',
          illegal_personal_detail: 'Client Name or Phone',
        });
      }).toThrow(AuditMetadataValidationError);

      expect(() => {
        validateAndSanitizeMetadata('shoot.created', 'owner', {
          shoot_id: '01920000-0000-7000-8000-000000000201',
          unauthorized_key: 'Should Fail',
        });
      }).toThrow(AuditMetadataValidationError);
    });
  });

  // AC-10
  describe('AC-10: ADR-0016 Product Documentation', () => {
    it('AC-10: docs/architecture/adr/0016-projects-and-pipeline.md is present with status Accepted', () => {
      const adrPath = path.resolve(
        import.meta.dirname,
        '../../docs/architecture/adr/0016-projects-and-pipeline.md',
      );
      expect(fs.existsSync(adrPath)).toBe(true);

      const content = fs.readFileSync(adrPath, 'utf8');
      expect(content).toMatch(/# ADR-0016: Projects and pipeline management/);
      expect(content).toMatch(/- Status:\s*Accepted/);
    });
  });

  // AC-11
  describe('AC-11: i18n Event String Parity', () => {
    it('AC-11: messages/en.json and messages/de.json define project_created, project_stage_changed, and shoot_scheduled under clients.timeline.events', () => {
      const enPath = path.resolve(import.meta.dirname, '../../messages/en.json');
      const dePath = path.resolve(import.meta.dirname, '../../messages/de.json');

      const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as I18nCatalogue;
      const de = JSON.parse(fs.readFileSync(dePath, 'utf8')) as I18nCatalogue;

      const enEvents = en.clients?.timeline?.events;
      const deEvents = de.clients?.timeline?.events;

      if (!enEvents || !deEvents) {
        throw new Error('Timeline events not found in i18n catalogues');
      }

      expect(enEvents.project_created).toBeDefined();
      expect(typeof enEvents.project_created).toBe('string');
      expect(enEvents.project_created?.trim().length).toBeGreaterThan(0);

      expect(deEvents.project_created).toBeDefined();
      expect(typeof deEvents.project_created).toBe('string');
      expect(deEvents.project_created?.trim().length).toBeGreaterThan(0);

      expect(enEvents.project_stage_changed).toBeDefined();
      expect(typeof enEvents.project_stage_changed).toBe('string');
      expect(enEvents.project_stage_changed).toContain('{from_stage}');
      expect(enEvents.project_stage_changed).toContain('{to_stage}');

      expect(deEvents.project_stage_changed).toBeDefined();
      expect(typeof deEvents.project_stage_changed).toBe('string');
      expect(deEvents.project_stage_changed).toContain('{from_stage}');
      expect(deEvents.project_stage_changed).toContain('{to_stage}');

      expect(enEvents.shoot_scheduled).toBeDefined();
      expect(typeof enEvents.shoot_scheduled).toBe('string');
      expect(enEvents.shoot_scheduled?.trim().length).toBeGreaterThan(0);

      expect(deEvents.shoot_scheduled).toBeDefined();
      expect(typeof deEvents.shoot_scheduled).toBe('string');
      expect(deEvents.shoot_scheduled?.trim().length).toBeGreaterThan(0);
    });
  });
});
