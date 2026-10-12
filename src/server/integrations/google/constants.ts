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
