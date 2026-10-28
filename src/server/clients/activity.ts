import { inArray, gte, ne, and, or, eq } from 'drizzle-orm';
import type { DbClient } from '@/server/db/client';
import { clientTimelineEvents, clientNotes } from '@/server/db/schema/timeline';
import { consentRecords } from '@/server/db/schema/consents';
import { clientContacts } from '@/server/db/schema/clients';
import { projectsActivityProvider } from '@/server/projects/privacy/activity-provider';
import { proposalsActivityProvider } from '@/server/proposals/privacy/activity-provider';

export interface ActivityProvider {
  id: string;
  activeClientIds: (
    tx: DbClient,
    since: Date,
    candidateIds: readonly string[],
  ) => Promise<string[] | Set<string>>;
}

const activityProviders = new Map<string, ActivityProvider>();

/**
 * Default domain activity providers for E1 (TASK-0019 / ADR-0012 §4.2):
 * 1. Non-system timeline events (occurred_at >= since AND actor_type != 'system')
 * 2. Client notes (updated_at >= since OR created_at >= since)
 * 3. Consent records (created_at >= since via client_contacts)
 */
const DEFAULT_ACTIVITY_PROVIDERS: readonly ActivityProvider[] = [
  {
    id: 'timeline',
    activeClientIds: async (tx, since, candidateIds) => {
      if (candidateIds.length === 0) return [];
      const rows = await tx
        .selectDistinct({ clientId: clientTimelineEvents.clientId })
        .from(clientTimelineEvents)
        .where(
          and(
            inArray(clientTimelineEvents.clientId, [...candidateIds]),
            gte(clientTimelineEvents.occurredAt, since),
            ne(clientTimelineEvents.actorType, 'system'),
          ),
        );
      return rows.map((r) => r.clientId);
    },
  },
  {
    id: 'notes',
    activeClientIds: async (tx, since, candidateIds) => {
      if (candidateIds.length === 0) return [];
      const rows = await tx
        .selectDistinct({ clientId: clientNotes.clientId })
        .from(clientNotes)
        .where(
          and(
            inArray(clientNotes.clientId, [...candidateIds]),
            or(gte(clientNotes.updatedAt, since), gte(clientNotes.createdAt, since)),
          ),
        );
      return rows.map((r) => r.clientId);
    },
  },
  {
    id: 'consents',
    activeClientIds: async (tx, since, candidateIds) => {
      if (candidateIds.length === 0) return [];
      const rows = await tx
        .selectDistinct({ clientId: clientContacts.clientId })
        .from(consentRecords)
        .innerJoin(clientContacts, eq(consentRecords.contactId, clientContacts.id))
        .where(
          and(
            inArray(clientContacts.clientId, [...candidateIds]),
            gte(consentRecords.createdAt, since),
          ),
        );
      return rows.map((r) => r.clientId);
    },
  },
  projectsActivityProvider,
  proposalsActivityProvider,
];

function initDefaultProviders(): void {
  for (const provider of DEFAULT_ACTIVITY_PROVIDERS) {
    activityProviders.set(provider.id, provider);
  }
}

/**
 * Registers an activity provider.
 */
export function registerActivityProvider(provider: ActivityProvider): void {
  activityProviders.set(provider.id, provider);
}

/**
 * Returns all registered activity providers.
 */
export function getActivityProviders(): ActivityProvider[] {
  return Array.from(activityProviders.values());
}

/**
 * Clears all activity providers from the registry.
 */
export function clearActivityProviders(): void {
  activityProviders.clear();
}

/**
 * Resets the activity provider registry back to default initial providers.
 */
export function resetActivityProviders(): void {
  activityProviders.clear();
  initDefaultProviders();
}

/**
 * Dispatches to all registered activity providers and returns a set of client IDs
 * that had activity at or after `since`.
 */
export async function findActiveClientIds(
  tx: DbClient,
  since: Date,
  candidateIds: readonly string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) {
    return new Set();
  }

  const activeIds = new Set<string>();
  const providers = getActivityProviders();

  for (const provider of providers) {
    const ids = await provider.activeClientIds(tx, since, candidateIds);
    for (const id of ids) {
      activeIds.add(id);
    }
  }

  return activeIds;
}

// Initialise default providers on module load
initDefaultProviders();
