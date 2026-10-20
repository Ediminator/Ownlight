/**
 * Scoped API key permissions and constants (ADR-0006, docs/security/security-baseline.md §2).
 */

export const SCOPES = {
  CLIENTS_READ: 'clients:read',
  CLIENTS_WRITE: 'clients:write',
  PROJECTS_READ: 'projects:read',
  PROJECTS_WRITE: 'projects:write',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  CALENDAR_READ: 'calendar:read',
  CALENDAR_WRITE: 'calendar:write',
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

export const CLIENTS_READ = SCOPES.CLIENTS_READ;
export const CLIENTS_WRITE = SCOPES.CLIENTS_WRITE;
export const PROJECTS_READ = SCOPES.PROJECTS_READ;
export const PROJECTS_WRITE = SCOPES.PROJECTS_WRITE;
export const SETTINGS_READ = SCOPES.SETTINGS_READ;
export const SETTINGS_WRITE = SCOPES.SETTINGS_WRITE;
export const CALENDAR_READ = SCOPES.CALENDAR_READ;
export const CALENDAR_WRITE = SCOPES.CALENDAR_WRITE;

export const ALL_SCOPES: readonly Scope[] = Object.freeze(Object.values(SCOPES));
