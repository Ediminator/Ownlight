import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: () => undefined,
      set: () => undefined,
      delete: () => undefined,
    }),
  headers: () => Promise.resolve(new Headers()),
}));

import { PUBLIC_AUTH_ACTIONS } from '@/server/auth/public-actions';
import { getOwnerSessionInfoAction, signOutEverywhereAction } from '@/server/auth/actions';
import * as mfaActions from '@/server/auth/mfa-actions';
import { UnauthorizedError } from '@/server/auth/guards';
import { scanServerActions, checkAllowlistComments } from '../helpers/server-action-scanner';

describe('AC-8 & AC-9: Repository-wide AST server action scanner and unauthenticated invocation', () => {
  it('AC-8: repository-wide AST scan verifies all server actions are guarded or allowlisted with justification comments', () => {
    const rootDir = path.resolve(process.cwd(), 'src');
    const publicActionsFile = path.resolve(process.cwd(), 'src/server/auth/public-actions.ts');

    const result = scanServerActions({
      rootDir,
      allowlist: PUBLIC_AUTH_ACTIONS,
      publicActionsFile,
      checkAllowlistComments: true,
    });

    // Verify all known server action files are discovered
    expect(result.discoveredFiles.length).toBeGreaterThanOrEqual(3);
    const normalizedFiles = result.discoveredFiles.map((f) => f.replace(/\\/g, '/'));
    expect(normalizedFiles).toContain('server/auth/actions.ts');
    expect(normalizedFiles).toContain('server/auth/mfa-actions.ts');
    expect(normalizedFiles).toContain('server/clients/actions.ts');
    expect(normalizedFiles).toContain('server/leads/actions.ts');

    // Verify each allowlisted entry carries a justification comment
    const commentViolations = checkAllowlistComments(publicActionsFile);
    expect(commentViolations).toEqual([]);

    // Assert 0 scanner violations across the entire repository
    expect(result.violations).toEqual([]);
  });

  it('AC-9: unauthenticated invocation of protected auth actions rejects with UnauthorizedError and returns no data', async () => {
    await expect(getOwnerSessionInfoAction()).rejects.toThrow(UnauthorizedError);
    await expect(signOutEverywhereAction()).rejects.toThrow(UnauthorizedError);
  });

  it('AC-9: unauthenticated invocation of every protected action in mfa-actions.ts rejects with UnauthorizedError and returns no data', async () => {
    const dummyRegistrationResponse = {
      id: 'mock-passkey-id',
      rawId: 'mock-passkey-raw-id',
      response: {
        clientDataJSON: 'mock-client-data',
        attestationObject: 'mock-attestation',
      },
      type: 'public-key' as const,
      clientExtensionResults: {},
    };

    const protectedMfaActionCalls: Record<string, () => Promise<unknown>> = {
      reauthenticateAction: () => mfaActions.reauthenticateAction({ password: 'dummy-pw' }),
      startTotpEnrolmentAction: () => mfaActions.startTotpEnrolmentAction(),
      verifyAndEnableTotpAction: () => mfaActions.verifyAndEnableTotpAction({ code: '123456' }),
      disableTotpAction: () => mfaActions.disableTotpAction(),
      regenerateRecoveryCodesAction: () => mfaActions.regenerateRecoveryCodesAction(),
      startPasskeyRegistrationAction: () => mfaActions.startPasskeyRegistrationAction(),
      completePasskeyRegistrationAction: () =>
        mfaActions.completePasskeyRegistrationAction({
          name: 'Test Passkey',
          response: dummyRegistrationResponse,
        }),
      deletePasskeyAction: () =>
        mfaActions.deletePasskeyAction({
          passkeyId: '00000000-0000-0000-0000-000000000000',
        }),
      listPasskeysAction: () => mfaActions.listPasskeysAction(),
      getMfaStatusAction: () => mfaActions.getMfaStatusAction(),
      postponeMfaAction: () => mfaActions.postponeMfaAction(),
      listActiveSessionsAction: () => mfaActions.listActiveSessionsAction(),
      revokeSessionByIdAction: () =>
        mfaActions.revokeSessionByIdAction({
          sessionId: '00000000-0000-0000-0000-000000000000',
        }),
    };

    const allowlistSet = new Set<string>(PUBLIC_AUTH_ACTIONS as readonly string[]);
    const allExportedFunctionNames = Object.entries(mfaActions)
      .filter(([, val]) => typeof val === 'function')
      .map(([key]) => key);

    const expectedProtectedNames = allExportedFunctionNames.filter(
      (name) => !allowlistSet.has(name),
    );

    // Verify all protected exports are covered in test matrix
    expect(Object.keys(protectedMfaActionCalls).sort()).toEqual(expectedProtectedNames.sort());

    // Invoke every protected action without a session and verify UnauthorizedError
    for (const [actionName, callFn] of Object.entries(protectedMfaActionCalls)) {
      await expect(
        callFn(),
        `Action "${actionName}" must reject with UnauthorizedError when unauthenticated`,
      ).rejects.toThrow(UnauthorizedError);
    }
  });
});
