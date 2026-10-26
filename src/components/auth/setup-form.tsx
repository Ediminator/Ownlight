'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { setupOwnerAction } from '@/server/auth/actions';

export function SetupForm({
  locale,
  requireToken = true,
}: {
  locale: string;
  requireToken?: boolean;
}) {
  const t = useTranslations('auth.setup');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [setupToken, setSetupToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await setupOwnerAction({
        setupToken: requireToken ? setupToken : '',
        name,
        email,
        password,
      });

      if (!result.success) {
        setError(result.error);
      } else {
        router.push(`/${locale}`);
        router.refresh();
      }
    });
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="bg-card text-card-foreground border rounded-lg shadow-sm p-6 sm:p-8">
        <form onSubmit={handleSubmit} data-testid="setup-form" className="space-y-4" noValidate>
          {error && (
            <div
              id="setup-error-msg"
              role="alert"
              aria-live="polite"
              data-testid="setup-error"
              className="p-3 text-sm font-medium rounded-md border text-red-950 bg-red-100 border-red-300 dark:text-red-100 dark:bg-red-950 dark:border-red-800"
            >
              {error}
            </div>
          )}

          {requireToken && (
            <div className="space-y-1.5">
              <label
                htmlFor="setup-token"
                className="text-sm font-medium leading-none text-foreground"
              >
                {t('setupToken')}
              </label>
              <input
                id="setup-token"
                name="setupToken"
                data-testid="setup-token-input"
                type="password"
                autoComplete="off"
                required
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'setup-error-msg' : undefined}
                value={setupToken}
                onChange={(e) => {
                  setSetupToken(e.target.value);
                }}
                placeholder={t('setupTokenPlaceholder')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="owner-name"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t('name')}
            </label>
            <input
              id="owner-name"
              name="name"
              data-testid="name-input"
              type="text"
              autoComplete="name"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'setup-error-msg' : undefined}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder={t('namePlaceholder')}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="owner-email"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t('email')}
            </label>
            <input
              id="owner-email"
              name="email"
              data-testid="email-input"
              type="email"
              autoComplete="email"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'setup-error-msg' : undefined}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              placeholder={t('emailPlaceholder')}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="owner-password"
              className="text-sm font-medium leading-none text-foreground"
            >
              {t('password')}
            </label>
            <input
              id="owner-password"
              name="password"
              data-testid="password-input"
              type="password"
              autoComplete="new-password"
              required
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'setup-error-msg' : undefined}
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
            data-testid="setup-submit-btn"
            disabled={isPending}
            className="w-full inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4"
          >
            {isPending ? t('submitting') : t('submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
