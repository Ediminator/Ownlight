'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signInAction } from '@/server/auth/actions';
import {
  verifyMfaTotpAction,
  verifyMfaRecoveryCodeAction,
  startPasskeyAuthenticationAction,
  completePasskeyAuthenticationAction,
} from '@/server/auth/mfa-actions';
import { base64UrlToBuffer, bufferToBase64Url, isWebAuthnSupported } from '@/lib/webauthn-client';

export function sanitizeCallbackUrl(raw: string | null | undefined, locale: string): string {
  if (!raw) return `/${locale}`;
  const trimmed = raw.trim();
  if (
    trimmed.startsWith('/') &&
    !trimmed.startsWith('//') &&
    !trimmed.includes('://') &&
    !trimmed.includes('\\')
  ) {
    return trimmed;
  }
  return `/${locale}`;
}

export function SignInForm({
  locale,
  setupAvailable = false,
}: {
  locale: string;
  setupAvailable?: boolean;
}) {
  const t = useTranslations('auth.signIn');
  const tCommon = useTranslations('auth.common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'), locale);

  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [mfaTicket, setMfaTicket] = useState<string | null>(null);
  const [mfaMode, setMfaMode] = useState<'totp' | 'recovery'>('totp');
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');

  const handleCredentialsSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await signInAction({ email, password });
      if (!result.success) {
        setError(result.error);
      } else if (result.data?.mfaRequired && result.data.mfaTicket) {
        setMfaTicket(result.data.mfaTicket);
        setStep('mfa');
      } else if (result.data?.mfaEnforced) {
        router.push(`/${locale}/settings/security?mfa_enforced=1`);
        router.refresh();
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    });
  };

  const handleMfaSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!mfaTicket) {
      setError('MFA session expired. Please sign in again.');
      setStep('credentials');
      return;
    }

    startTransition(async () => {
      let result;
      if (mfaMode === 'totp') {
        result = await verifyMfaTotpAction({ mfaTicket, code: totpCode });
      } else {
        result = await verifyMfaRecoveryCodeAction({ mfaTicket, recoveryCode });
      }

      if (!result.success) {
        setError(result.error);
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    });
  };

  const handlePasskeySignIn = () => {
    setError(null);

    if (!isWebAuthnSupported()) {
      setError(t('passkeyNotSupported'));
      return;
    }

    startTransition(async () => {
      try {
        const startResult = await startPasskeyAuthenticationAction();
        if (!startResult.success || !startResult.data) {
          setError(startResult.error ?? 'Failed to start passkey authentication.');
          return;
        }

        const options = startResult.data.options;
        const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
          challenge: base64UrlToBuffer(options.challenge),
          rpId: options.rpId,
          userVerification: options.userVerification,
          timeout: options.timeout,
        };

        const credential = (await navigator.credentials.get({
          publicKey: publicKeyCredentialRequestOptions,
        })) as PublicKeyCredential | null;

        if (!credential) {
          setError('Passkey authentication was cancelled.');
          return;
        }

        const response = credential.response as AuthenticatorAssertionResponse;
        const assertionJSON = {
          id: credential.id,
          response: {
            clientDataJSON: bufferToBase64Url(response.clientDataJSON),
            authenticatorData: bufferToBase64Url(response.authenticatorData),
            signature: bufferToBase64Url(response.signature),
            userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : undefined,
          },
        };

        const verifyResult = await completePasskeyAuthenticationAction({
          challenge: options.challenge,
          response: assertionJSON,
        });

        if (!verifyResult.success) {
          setError(verifyResult.error);
        } else {
          router.push(callbackUrl);
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Passkey sign-in failed.');
      }
    });
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {step === 'mfa' ? t('mfaTitle') : t('title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {step === 'mfa' ? t('mfaDescription') : t('description')}
        </p>
      </div>

      {setupAvailable && (
        <div
          data-testid="signin-setup-callout"
          role="region"
          aria-label={t('setupAvailablePrompt')}
          className="p-4 rounded-lg border border-primary/30 bg-primary/5 text-sm text-foreground flex flex-col sm:flex-row items-center justify-between gap-3"
        >
          <span>{t('setupAvailablePrompt')}</span>
          <Link
            href={`/${locale}/setup`}
            data-testid="signin-setup-callout-link"
            className="inline-flex items-center text-primary font-medium hover:underline text-sm shrink-0"
          >
            {t('setupAvailableLink')} &rarr;
          </Link>
        </div>
      )}

      <div className="bg-card text-card-foreground border rounded-lg shadow-sm p-6 sm:p-8">
        {error && (
          <div
            id="signin-error-msg"
            role="alert"
            aria-live="polite"
            data-testid="signin-error"
            className="mb-4 p-3 text-sm font-medium rounded-md border text-red-950 bg-red-100 border-red-300 dark:text-red-100 dark:bg-red-950 dark:border-red-800"
          >
            {error}
          </div>
        )}

        {step === 'credentials' ? (
          <div className="space-y-4">
            <form
              onSubmit={handleCredentialsSubmit}
              data-testid="signin-form"
              className="space-y-4"
              noValidate
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="signin-email"
                  className="text-sm font-medium leading-none text-foreground"
                >
                  {t('email')}
                </label>
                <input
                  id="signin-email"
                  name="email"
                  data-testid="email-input"
                  type="email"
                  autoComplete="email"
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'signin-error-msg' : undefined}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                  }}
                  placeholder={t('emailPlaceholder')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="signin-password"
                    className="text-sm font-medium leading-none text-foreground"
                  >
                    {t('password')}
                  </label>
                  <Link
                    href={`/${locale}/forgot-password`}
                    className="text-xs text-primary hover:underline py-1 min-h-[24px] inline-flex items-center"
                  >
                    {t('forgotPassword')}
                  </Link>
                </div>
                <input
                  id="signin-password"
                  name="password"
                  data-testid="password-input"
                  type="password"
                  autoComplete="current-password"
                  required
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'signin-error-msg' : undefined}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                  }}
                  placeholder={t('passwordPlaceholder')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                data-testid="signin-submit-btn"
                disabled={isPending}
                className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
              >
                {isPending ? t('submitting') : t('submit')}
              </button>
            </form>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-muted" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">{tCommon('or')}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handlePasskeySignIn}
              data-testid="passkey-signin-btn"
              disabled={isPending}
              className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 py-2 px-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {t('signInWithPasskey')}
            </button>
          </div>
        ) : (
          <form
            onSubmit={handleMfaSubmit}
            data-testid="mfa-challenge-form"
            className="space-y-4"
            noValidate
          >
            {mfaMode === 'totp' ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="mfa-code-input"
                  className="text-sm font-medium leading-none text-foreground"
                >
                  {t('mfaCode')}
                </label>
                <input
                  id="mfa-code-input"
                  data-testid="mfa-code-input"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="one-time-code"
                  required
                  value={totpCode}
                  onChange={(e) => {
                    setTotpCode(e.target.value);
                  }}
                  placeholder={t('mfaCodePlaceholder')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 text-center tracking-widest text-lg font-mono"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label
                  htmlFor="recovery-code-input"
                  className="text-sm font-medium leading-none text-foreground"
                >
                  {t('recoveryCode')}
                </label>
                <input
                  id="recovery-code-input"
                  data-testid="recovery-code-input"
                  name="recoveryCode"
                  type="text"
                  required
                  value={recoveryCode}
                  onChange={(e) => {
                    setRecoveryCode(e.target.value);
                  }}
                  placeholder={t('recoveryCodePlaceholder')}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono text-center"
                />
              </div>
            )}

            <button
              type="submit"
              data-testid="mfa-submit-btn"
              disabled={isPending}
              className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
            >
              {isPending ? t('verifyingMfa') : t('verifyMfa')}
            </button>

            <div className="flex flex-col items-center gap-2 pt-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMfaMode(mfaMode === 'totp' ? 'recovery' : 'totp');
                }}
                className="text-primary hover:underline"
              >
                {mfaMode === 'totp' ? t('useRecoveryCode') : t('useAuthenticator')}
              </button>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep('credentials');
                }}
                className="text-muted-foreground hover:underline"
              >
                {t('backToPassword')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
