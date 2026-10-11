import 'server-only';
import { cookies } from 'next/headers';
import { db, type DbClient } from '@/server/db/client';
import { verifySession, SESSION_COOKIE_NAME, SECURE_SESSION_COOKIE_NAME } from './session';

/**
 * Checks if the current session was authenticated or re-authenticated within the last 5 minutes.
 * Required for sensitive MFA operations (AC-6 / TASK-0018).
 */
export async function assertFreshReauthentication(
  userId: string,
  client: DbClient = db,
  sessionTokenOverride?: string,
): Promise<void> {
  let sessionToken: string | undefined = sessionTokenOverride;
  if (!sessionToken) {
    try {
      const cookieStore = await cookies();
      sessionToken =
        cookieStore.get(SECURE_SESSION_COOKIE_NAME)?.value ??
        cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      sessionToken = undefined;
    }
  }

  if (!sessionToken) {
    throw new Error('REAUTH_REQUIRED: No active session cookie found.');
  }

  const verified = await verifySession(sessionToken, client);
  if (verified?.user.id !== userId) {
    throw new Error('REAUTH_REQUIRED: Invalid session.');
  }

  const fiveMinutesMs = 5 * 60 * 1000;
  const lastReauth = verified.session.lastReauthenticatedAt;
  const ageMs = Date.now() - new Date(lastReauth).getTime();

  if (ageMs > fiveMinutesMs) {
    const err = new Error('REAUTH_REQUIRED: Re-authentication required for sensitive operation.');
    err.name = 'ReauthenticationRequiredError';
    throw err;
  }
}
