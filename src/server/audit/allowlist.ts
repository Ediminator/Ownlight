import { logger } from '@/server/log';
import { type ActorType, AuditMetadataValidationError } from './types';

/**
 * Standard agent and token attribution metadata fields (TASK-0007).
 */
export const AGENT_ATTRIBUTION_KEYS = [
  'token_id',
  'tool_name',
  'command_name',
  'args_hash',
] as const;

export const CLIENT_AUDIT_KEYS = [
  'changed_fields',
  'contact_id',
  'address_type',
  'duplicate_acknowledged',
] as const;

export const ACTION_METADATA_ALLOWLIST = new Map<string, readonly string[]>([
  ['auth.setup.completed', ['owner_id', 'setup_method', 'ip_anonymized']],
  ['auth.sign_in.success', ['session_id', 'auth_method', 'ip_anonymized']],
  ['auth.sign_in.failure', ['failure_reason', 'ip_anonymized']],
  ['auth.sign_out.success', ['session_id', 'everywhere']],
  ['auth.password_reset.requested', ['rate_limit_bucket', 'ip_anonymized']],
  ['auth.password_reset.completed', ['duration_ms']],
  ['auth.mfa.totp_enabled', ['user_id', 'ip_anonymized']],
  ['auth.mfa.totp_disabled', ['user_id', 'ip_anonymized']],
  ['auth.mfa.recovery_code_used', ['user_id', 'code_id', 'ip_anonymized']],
  ['auth.mfa.recovery_codes_regenerated', ['user_id', 'count', 'ip_anonymized']],
  ['auth.mfa.passkey_registered', ['user_id', 'passkey_id', 'passkey_name', 'ip_anonymized']],
  ['auth.mfa.passkey_deleted', ['user_id', 'passkey_id', 'ip_anonymized']],
  ['auth.mfa.postponed', ['user_id', 'postponed_until', 'ip_anonymized']],
  [
    'retention.sweep.completed',
    [
      'policy_id',
      'scanned_count',
      'deleted_count',
      'held_count',
      'failed_count',
      'dry_run',
      'duration_ms',
      'policies',
    ],
  ],
  ['agent.tool.invoked', [...AGENT_ATTRIBUTION_KEYS, 'status', 'duration_ms']],
  ['agent.command.executed', [...AGENT_ATTRIBUTION_KEYS, 'exit_code', 'duration_ms']],
  ['client.created', CLIENT_AUDIT_KEYS],
  ['client.updated', CLIENT_AUDIT_KEYS],
  ['client.contact.added', CLIENT_AUDIT_KEYS],
  ['client.contact.updated', CLIENT_AUDIT_KEYS],
  ['client.contact.removed', CLIENT_AUDIT_KEYS],
  ['client.address.upserted', CLIENT_AUDIT_KEYS],
  ['client.address.removed', CLIENT_AUDIT_KEYS],
  ['client.tags.changed', ['tag_count', 'created_tag_count']],
  ['client.note.created', ['note_id']],
  ['client.note.updated', ['note_id']],
  ['client.note.deleted', ['note_id']],
  ['consent.granted', ['contact_id', 'purpose', 'method']],
  ['consent.withdrawn', ['contact_id', 'purpose', 'method']],
  ['client.legal_hold.set', ['reason', 'until']],
  ['client.legal_hold.updated', ['reason', 'until']],
  ['client.legal_hold.released', ['reason']],
  ['privacy.export.generated', ['contact_id', 'format', 'locale', 'category_count']],
  ['privacy.erasure.completed', ['subject_kind', 'category_counts']],
  ['privacy.erasure.blocked', ['subject_kind', 'hold_count']],
  ['integration.google.connected', ['provider', 'scope', 'scopes', 'user_id', 'ip_anonymized']],
  [
    'integration.google.disconnected',
    ['provider', 'delete_synced_contacts', 'remote_revoked', 'user_id', 'ip_anonymized'],
  ],
]);

/**
 * Validates metadata keys against the action's allowlist.
 * In development and test environments: throws AuditMetadataValidationError on unknown keys.
 * In production: drops unknown keys, logs a warning, and returns the sanitized object.
 */
export function validateAndSanitizeMetadata(
  action: string,
  actorType: ActorType,
  metadata?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) {
    return null;
  }

  // 1. Compute allowed keys set
  const baseAllowed = ACTION_METADATA_ALLOWLIST.get(action) ?? [];
  const allowedSet = new Set<string>(baseAllowed);

  // If actor is an agent or token, always permit agent attribution fields
  if (actorType === 'agent' || actorType === 'token') {
    for (const key of AGENT_ATTRIBUTION_KEYS) {
      allowedSet.add(key);
    }
  }

  // 2. Identify forbidden keys
  const keys = Object.keys(metadata);
  const forbiddenKeys = keys.filter((key) => !allowedSet.has(key));

  if (forbiddenKeys.length === 0) {
    return metadata;
  }

  // 3. Dev / Test: fail fast with typed error
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    throw new AuditMetadataValidationError(action, forbiddenKeys);
  }

  // 4. Production: drop unauthorized keys and warn
  logger.warn(
    {
      action,
      actorType,
      droppedKeys: forbiddenKeys,
    },
    'Dropped unauthorized audit metadata keys in production',
  );

  const sanitized = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => allowedSet.has(key)),
  );

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}
