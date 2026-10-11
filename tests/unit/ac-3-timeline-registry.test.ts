import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  registerTimelineEventType,
  getTimelineEventType,
  getAllTimelineEventTypes,
  resetTimelineRegistry,
} from '@/server/timeline/registry';
import { recordTimelineEvent } from '@/server/timeline/service';
import type { DbClient } from '@/server/db/client';

describe('AC-3: Timeline event registry and payload validation', () => {
  beforeEach(() => {
    resetTimelineRegistry();
  });

  it('AC-3: registers default core event types', () => {
    const types = getAllTimelineEventTypes().map((t) => t.type);
    expect(types).toContain('client.created');
    expect(types).toContain('client.contact.added');
    expect(types).toContain('client.contact.removed');
    expect(types).toContain('note.created');

    const clientCreated = getTimelineEventType('client.created');
    expect(clientCreated).toBeDefined();
    expect(clientCreated?.messageKey).toBe('clients.timeline.events.client_created');
    expect(clientCreated?.dataKeys).toEqual([]);
  });

  it('AC-3: registers new custom event types with allowlists', () => {
    registerTimelineEventType({
      type: 'custom.event',
      dataKeys: ['counter', 'status'],
      messageKey: 'clients.timeline.events.custom',
    });

    const registered = getTimelineEventType('custom.event');
    expect(registered).toBeDefined();
    expect(registered?.dataKeys).toEqual(['counter', 'status']);
  });

  it('AC-3: recordTimelineEvent throws in dev/test when event type is unregistered', async () => {
    try {
      vi.stubEnv('NODE_ENV', 'test');
      const fakeTx = {} as DbClient;

      await expect(
        recordTimelineEvent(fakeTx, {
          clientId: '018f0000-0000-7000-8000-000000000001',
          type: 'unregistered.event.type',
          actorType: 'owner',
        }),
      ).rejects.toThrow(/Unregistered timeline event type: unregistered\.event\.type/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('AC-3: recordTimelineEvent in production drops unregistered event and returns null', async () => {
    try {
      vi.stubEnv('NODE_ENV', 'production');
      const fakeTx = {} as DbClient;

      const result = await recordTimelineEvent(fakeTx, {
        clientId: '018f0000-0000-7000-8000-000000000001',
        type: 'unregistered.event.type',
        actorType: 'owner',
      });

      expect(result).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('AC-3: recordTimelineEvent throws in dev/test when payload has non-allowlisted data keys', async () => {
    try {
      vi.stubEnv('NODE_ENV', 'test');
      const fakeTx = {} as DbClient;

      await expect(
        recordTimelineEvent(fakeTx, {
          clientId: '018f0000-0000-7000-8000-000000000001',
          type: 'client.created',
          actorType: 'owner',
          data: { illegal_pii_key: 'sensitive-value' },
        }),
      ).rejects.toThrow(
        /Timeline event key 'illegal_pii_key' not allowed for type 'client\.created'/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('AC-3: recordTimelineEvent in production drops non-allowlisted keys and preserves allowlisted keys', async () => {
    try {
      vi.stubEnv('NODE_ENV', 'production');

      registerTimelineEventType({
        type: 'test.allowlist',
        dataKeys: ['valid_key'],
        messageKey: 'clients.timeline.events.test',
      });

      let insertedData: Record<string, unknown> | undefined;
      const fakeTx = {
        insert: () => ({
          values: (vals: { data: Record<string, unknown> }) => {
            insertedData = vals.data;
            return {
              returning: () => Promise.resolve([vals]),
            };
          },
        }),
      } as unknown as DbClient;

      const result = await recordTimelineEvent(fakeTx, {
        clientId: '018f0000-0000-7000-8000-000000000001',
        type: 'test.allowlist',
        actorType: 'owner',
        data: {
          valid_key: 'allowed',
          unwanted_secret: 'dropped',
        },
      });

      expect(result).toBeDefined();
      expect(insertedData).toEqual({ valid_key: 'allowed' });
      expect(insertedData).not.toHaveProperty('unwanted_secret');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
