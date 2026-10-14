import type { Lead } from '@/server/db/schema/leads';
import type { DbClient } from '@/server/db/client';

export interface LeadConversionStep {
  id: string;
  run: (lead: Lead, clientId: string, tx: DbClient) => Promise<void>;
}

const steps: LeadConversionStep[] = [];

/**
 * Registers a post-conversion step executed within the conversion transaction (D1, AC-7).
 * E2 registry is empty by default; E3 registers project creation from the converted lead.
 */
export function registerLeadConversionStep(step: LeadConversionStep): void {
  const existingIndex = steps.findIndex((s) => s.id === step.id);
  if (existingIndex >= 0) {
    steps.splice(existingIndex, 1, step);
  } else {
    steps.push(step);
  }
}

/**
 * Returns all currently registered conversion steps.
 */
export function getLeadConversionSteps(): readonly LeadConversionStep[] {
  return [...steps];
}

/**
 * Clears all registered conversion steps (used for test isolation).
 */
export function resetLeadConversionSteps(): void {
  steps.length = 0;
}
