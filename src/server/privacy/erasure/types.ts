import type { DbClient } from '@/server/db/client';

export type ErasureSubject =
  | { kind: 'client'; clientId: string }
  | { kind: 'contact'; clientId: string; contactId: string }
  | { kind: 'lead'; leadId: string };

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
  subjectKinds?: readonly ('client' | 'contact' | 'lead')[];
  plan: (subject: ErasureSubject, tx: DbClient) => Promise<number>;
  erase: (subject: ErasureSubject, tx: DbClient) => Promise<number>;
}

export interface ErasurePlan {
  subjectKind: 'client' | 'contact' | 'lead';
  categoryCounts: Record<string, number>;
  holds: ErasureHold[];
  notesMayMentionPerson: boolean;
}

export type ErasureActor =
  { actorType: 'owner'; actorId: string | null } | { actorType: 'system'; actorId: string };

export type ErasureResult =
  | {
      success: true;
      subjectKind: 'client' | 'contact' | 'lead';
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
        | 'CONVERTED_LEAD'
        | 'INTERNAL_ERROR';
      error: string;
    };
