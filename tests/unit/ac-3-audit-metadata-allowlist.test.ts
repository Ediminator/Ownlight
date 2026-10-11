import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateAndSanitizeMetadata, AuditMetadataValidationError } from '@/server/audit';

vi.mock('server-only', () => ({}));

describe('AC-3: Audit metadata allowlist enforcement across environments', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('AC-3: permits allowlisted metadata keys without throwing in dev/test', () => {
    const validMeta = {
      session_id: 'sess-12345',
      auth_method: 'password',
      ip_anonymized: '192.168.1.0/24',
    };

    const sanitized = validateAndSanitizeMetadata('auth.sign_in.success', 'owner', validMeta);
    expect(sanitized).toEqual(validMeta);
  });

  it('AC-3: throws AuditMetadataValidationError in dev/test when metadata contains keys outside allowlist', () => {
    const invalidMeta = {
      session_id: 'sess-12345',
      unauthorized_secret_field: 'leak_candidate',
      another_bad_key: 123,
    };

    expect(() => {
      validateAndSanitizeMetadata('auth.sign_in.success', 'owner', invalidMeta);
    }).toThrow(AuditMetadataValidationError);

    try {
      validateAndSanitizeMetadata('auth.sign_in.success', 'owner', invalidMeta);
      expect.unreachable('Should have thrown AuditMetadataValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(AuditMetadataValidationError);
      const validationError = err as AuditMetadataValidationError;
      expect(validationError.forbiddenKeys).toContain('unauthorized_secret_field');
      expect(validationError.forbiddenKeys).toContain('another_bad_key');
      expect(validationError.action).toBe('auth.sign_in.success');
    }
  });

  it('AC-3: permits agent attribution fields when actor_type is agent or token', () => {
    const agentMeta = {
      token_id: 'tok-abc-123',
      tool_name: 'git_status',
      command_name: 'status',
      args_hash: 'sha256:abcdef0123456789',
    };

    // Valid for 'agent'
    const agentResult = validateAndSanitizeMetadata('agent.tool.invoked', 'agent', agentMeta);
    expect(agentResult).toEqual(agentMeta);

    // Valid for 'token'
    const tokenResult = validateAndSanitizeMetadata('agent.command.executed', 'token', agentMeta);
    expect(tokenResult).toEqual(agentMeta);

    // For non-agent/non-token actor (e.g. client), agent keys are rejected if not in base allowlist
    expect(() => {
      validateAndSanitizeMetadata('auth.sign_in.success', 'client', {
        session_id: 'sess-1',
        tool_name: 'malicious_injection',
      });
    }).toThrow(AuditMetadataValidationError);
  });

  it('AC-3: in production environment, drops unauthorized keys and does not throw', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const mixedMeta = {
      session_id: 'sess-valid-prod',
      auth_method: 'password',
      unauthorized_extra_field: 'should_be_dropped',
      leaked_query_param: 'drop_me_too',
    };

    const sanitized = validateAndSanitizeMetadata('auth.sign_in.success', 'owner', mixedMeta);

    expect(sanitized).toEqual({
      session_id: 'sess-valid-prod',
      auth_method: 'password',
    });
    expect(sanitized).not.toHaveProperty('unauthorized_extra_field');
    expect(sanitized).not.toHaveProperty('leaked_query_param');
  });

  it('AC-3: in production environment, returns null if all metadata keys are unauthorized', () => {
    vi.stubEnv('NODE_ENV', 'production');

    const allBadMeta = {
      bad_key_1: 'value',
      bad_key_2: 42,
    };

    const sanitized = validateAndSanitizeMetadata('auth.sign_in.success', 'owner', allBadMeta);
    expect(sanitized).toBeNull();
  });

  it('AC-3: handles empty or null metadata safely', () => {
    expect(validateAndSanitizeMetadata('auth.sign_in.success', 'owner', null)).toBeNull();
    expect(validateAndSanitizeMetadata('auth.sign_in.success', 'owner', undefined)).toBeNull();
    expect(validateAndSanitizeMetadata('auth.sign_in.success', 'owner', {})).toBeNull();
  });

  it('AC-9: permits contact_id, purpose, method for consent.granted and consent.withdrawn', () => {
    const meta = {
      contact_id: '018f0000-0000-7000-8000-000000000001',
      purpose: 'marketing',
      method: 'in_person',
    };

    expect(validateAndSanitizeMetadata('consent.granted', 'owner', meta)).toEqual(meta);
    expect(validateAndSanitizeMetadata('consent.withdrawn', 'owner', meta)).toEqual(meta);

    // Rejects forbidden PII like scope or evidence_note or name
    expect(() =>
      validateAndSanitizeMetadata('consent.granted', 'owner', {
        ...meta,
        scope: 'forbidden scope',
      }),
    ).toThrow(AuditMetadataValidationError);
  });
});
