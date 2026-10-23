export const GOOGLE_OAUTH_PURPOSE = 'ownlight:vault:google_oauth' as const;
export const GOOGLE_CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts' as const;

export const DEFAULT_GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const DEFAULT_GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DEFAULT_GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export function getGoogleAuthUrl(): string {
  return process.env.GOOGLE_AUTH_URL_OVERRIDE ?? DEFAULT_GOOGLE_AUTH_URL;
}

export function getGoogleTokenUrl(): string {
  return process.env.GOOGLE_TOKEN_URL_OVERRIDE ?? DEFAULT_GOOGLE_TOKEN_URL;
}

export function getGoogleRevokeUrl(): string {
  return process.env.GOOGLE_REVOKE_URL_OVERRIDE ?? DEFAULT_GOOGLE_REVOKE_URL;
}

export const DEFAULT_GOOGLE_PEOPLE_API_BASE = 'https://people.googleapis.com/v1';

export function getGooglePeopleApiBase(): string {
  return (
    process.env.GOOGLE_PEOPLE_API_BASE_OVERRIDE ??
    process.env.GOOGLE_PEOPLE_API_BASE_URL ??
    DEFAULT_GOOGLE_PEOPLE_API_BASE
  );
}

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events' as const;
export const DEFAULT_GOOGLE_CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3' as const;

export function getGoogleCalendarApiBase(): string {
  return (
    process.env.GOOGLE_CALENDAR_API_BASE_OVERRIDE ??
    process.env.GOOGLE_CALENDAR_API_BASE_URL ??
    DEFAULT_GOOGLE_CALENDAR_API_BASE
  );
}

/**
 * Safely parses space-delimited OAuth 2.0 scopes and checks whether Google Calendar scope is granted.
 * Uses exact token matching instead of URL substring matching to prevent CodeQL
 * js/incomplete-url-substring-sanitization alerts.
 */
export function hasGoogleCalendarScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  const grantedScopes = new Set(scope.split(/\s+/).filter(Boolean));
  return (
    grantedScopes.has(GOOGLE_CALENDAR_SCOPE) ||
    grantedScopes.has('https://www.googleapis.com/auth/calendar')
  );
}

/**
 * Safely parses space-delimited OAuth 2.0 scopes and checks whether Google Contacts scope is granted.
 */
export function hasGoogleContactsScope(scope: string | null | undefined): boolean {
  if (!scope) return false;
  const grantedScopes = new Set(scope.split(/\s+/).filter(Boolean));
  return (
    grantedScopes.has(GOOGLE_CONTACTS_SCOPE) ||
    grantedScopes.has('https://www.googleapis.com/auth/contacts.readonly')
  );
}
