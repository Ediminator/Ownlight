import type { DbClient } from '@/server/db/client';

export type ErasureSubject =
  { kind: 'client'; clientId: string } | { kind: 'contact'; clientId: string; contactId: string };

export interface ErasureHold {
  reason: string;
  retainUntil: Date | string | null;
}

export interface ErasureHoldProvider {
  id: string;
  holds: (subject: ErasureSubject, tx: DbClient) => Promise<ErasureHold[]>;
}

export interface ErasureProvider {
  id: string;
  category: string;
  coveredTables: readonly string[];
  plan: (subject: ErasureSubject, tx: DbClient) => Promise<number>;
  erase: (subject: ErasureSubject, tx: DbClient) => Promise<number>;
}

export interface ErasurePlan {
  subjectKind: 'client' | 'contact';
  categoryCounts: Record<string, number>;
  holds: ErasureHold[];
  notesMayMentionPerson: boolean;
}

export type ErasureActor =
  { actorType: 'owner'; actorId: string | null } | { actorType: 'system'; actorId: string };

export type ErasureResult =
  | {
      success: true;
      subjectKind: 'client' | 'contact';
      categoryCounts: Record<string, number>;
    }
  | {
      success: false;
      code: 'ERASURE_BLOCKED';
      holds: ErasureHold[];
    }
  | {
      success: false;
      code:
        | 'NOT_FOUND'
        | 'FORBIDDEN'
        | 'UNAUTHORIZED'
        | 'REAUTH_REQUIRED'
        | 'CONFIRMATION_MISMATCH'
        | 'VALIDATION_FAILED'
        | 'INTERNAL_ERROR';
      error: string;
    };
