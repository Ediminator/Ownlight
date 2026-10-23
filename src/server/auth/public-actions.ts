/**
 * Explicit allowlist of server actions that do not require an active owner session (AC-9 / TASK-0018).
 * Maintained in a separate module because 'use server' files can only export async functions.
 * Every entry MUST carry a justification comment naming its compensating control.
 */
export const PUBLIC_AUTH_ACTIONS = [
  // Compensating control: One-time setup only; fails permanently if an owner exists; rate-limited.
  'setupOwnerAction',
  // Compensating control: Rate-limited per IP and email; requires valid password credentials; returns MFA ticket if 2FA enabled.
  'signInAction',
  // Compensating control: Clears active session cookie; safe no-op if unauthenticated.
  'signOutAction',
  // Compensating control: Rate-limited per IP and email; timing-safe (always returns success); sends out-of-band email token.
  'requestPasswordResetAction',
  // Compensating control: Requires unexpired single-use reset token from email; rate-limited.
  'resetPasswordAction',
  // Compensating control: Requires valid unexpired MFA ticket; rate-limited per email and IP.
  'verifyMfaTotpAction',
  // Compensating control: Requires valid unexpired MFA ticket; rate-limited per email and IP; single-use code.
  'verifyMfaRecoveryCodeAction',
  // Compensating control: Generates unguessable WebAuthn challenge with 5-minute expiry in verification table.
  'startPasskeyAuthenticationAction',
  // Compensating control: Validates WebAuthn signature against unexpired challenge; single-use challenge consumption; rate-limited.
  'completePasskeyAuthenticationAction',
  // Compensating control: Public inquiry submission; honeypot, per-IP and per-form rate limits, dynamic schema validation, PoW challenge from TASK-0029.
  'submitInquiryAction',
  // Compensating control: Public booking availability lookup; read-only against active booking types and availability schedules; no PII touched.
  'getPublicAvailableSlotsAction',
  // Compensating control: Public booking PoW challenge generation; rate-limited per IP (30 per 10 min), signed with studio HMAC secret.
  'getPublicBookingChallengeAction',
  // Compensating control: Public appointment reservation; strict Zod validation, ALTCHA PoW verification, honeypot field, per-IP rate limiting (5 per 15 min), and serializable double-booking collision rollback.
  'submitPublicBookingAction',
] as const;

export type PublicAuthAction = (typeof PUBLIC_AUTH_ACTIONS)[number];

export function isPublicAuthAction(actionName: string): boolean {
  return (PUBLIC_AUTH_ACTIONS as readonly string[]).includes(actionName);
}
