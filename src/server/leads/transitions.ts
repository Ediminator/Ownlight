import { LEAD_STATUSES, type LeadStatus } from '@/server/db/schema/leads';

export { LEAD_STATUSES, type LeadStatus };

/**
 * ADR-0015 §6 full theoretical transition matrix.
 * Note: 'converted' is reachable only via conversion flow (TASK-0032),
 * never directly via changeLeadStatus (AC-2).
 */
export const ADR_0015_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ['contacted', 'archived', 'spam', 'converted'],
  contacted: ['archived', 'spam', 'converted'],
  archived: ['new'],
  spam: ['new'],
  converted: [],
};

/**
 * Evaluates whether a status transition is permitted through changeLeadStatus.
 *
 * Rules (ADR-0015 §6 & TASK-0026 AC-2):
 * - Target 'converted' is NOT reachable through changeLeadStatus.
 * - Transitions from 'converted' are impossible (terminal state).
 * - Self-transitions (from === to) are rejected.
 * - Only the remaining 7 permitted pairs succeed:
 *   new -> contacted, new -> archived, new -> spam,
 *   contacted -> archived, contacted -> spam,
 *   archived -> new, spam -> new.
 */
export function isAllowedLeadStatusTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  if (from === 'converted' || to === 'converted') return false;

  switch (from) {
    case 'new':
      return to === 'contacted' || to === 'archived' || to === 'spam';
    case 'contacted':
      return to === 'archived' || to === 'spam';
    case 'archived':
      return to === 'new';
    case 'spam':
      return to === 'new';
    default:
      return false;
  }
}
