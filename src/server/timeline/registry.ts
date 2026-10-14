import type { DbClient } from '@/server/db/client';

export interface TimelineEventTypeDefinition {
  type: string;
  dataKeys: readonly string[];
  messageKey: string;
  resolve?: (
    event: {
      id: string;
      subjectType: string | null;
      subjectId: string | null;
      data: Record<string, unknown>;
    },
    ctx: { db: DbClient },
  ) => Promise<Record<string, unknown> | null>;
}

const INITIAL_EVENT_TYPES: TimelineEventTypeDefinition[] = [
  {
    type: 'client.created',
    dataKeys: [],
    messageKey: 'clients.timeline.events.client_created',
  },
  {
    type: 'client.contact.added',
    dataKeys: [],
    messageKey: 'clients.timeline.events.client_contact_added',
  },
  {
    type: 'client.contact.removed',
    dataKeys: [],
    messageKey: 'clients.timeline.events.client_contact_removed',
  },
  {
    type: 'note.created',
    dataKeys: [],
    messageKey: 'clients.timeline.events.note_created',
  },
  {
    type: 'consent.granted',
    dataKeys: ['purpose'],
    messageKey: 'clients.timeline.events.consent_granted',
  },
  {
    type: 'consent.withdrawn',
    dataKeys: ['purpose'],
    messageKey: 'clients.timeline.events.consent_withdrawn',
  },
  {
    type: 'inquiry.received',
    dataKeys: [],
    messageKey: 'clients.timeline.events.inquiry_received',
  },
  {
    type: 'lead.converted',
    dataKeys: ['mode'],
    messageKey: 'clients.timeline.events.lead_converted',
  },
];

const registry = new Map<string, TimelineEventTypeDefinition>();

function initDefaultTypes(): void {
  for (const def of INITIAL_EVENT_TYPES) {
    registry.set(def.type, def);
  }
}

// Initialise defaults on module load
initDefaultTypes();

/**
 * Registers a new timeline event type definition.
 * Later epics call this to declare allowed types, data keys, and message keys.
 */
export function registerTimelineEventType(def: TimelineEventTypeDefinition): void {
  registry.set(def.type, def);
}

/**
 * Looks up a registered timeline event type.
 */
export function getTimelineEventType(type: string): TimelineEventTypeDefinition | undefined {
  return registry.get(type);
}

/**
 * Returns all registered timeline event definitions.
 */
export function getAllTimelineEventTypes(): TimelineEventTypeDefinition[] {
  return Array.from(registry.values());
}

/**
 * Resets the registry back to the default initial types (for testing isolation).
 */
export function resetTimelineRegistry(): void {
  registry.clear();
  initDefaultTypes();
}
