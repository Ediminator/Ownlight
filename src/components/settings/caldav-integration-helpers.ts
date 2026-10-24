export interface CaldavCredentialsForm {
  serverUrl: string;
  username: string;
  password: string;
}

export interface CaldavFormErrors {
  serverUrl?: string;
  username?: string;
  password?: string;
  calendar?: string;
}

export function validateCaldavCredentials(
  form: CaldavCredentialsForm,
  messages: {
    serverUrlRequired: string;
    invalidServerUrl: string;
    usernameRequired: string;
    passwordRequired: string;
  },
): { isValid: boolean; errors: CaldavFormErrors } {
  const errors: CaldavFormErrors = {};

  const trimmedUrl = form.serverUrl.trim();
  if (!trimmedUrl) {
    errors.serverUrl = messages.serverUrlRequired;
  } else {
    try {
      const parsed = new URL(trimmedUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.serverUrl = messages.invalidServerUrl;
      }
    } catch {
      errors.serverUrl = messages.invalidServerUrl;
    }
  }

  if (!form.username.trim()) {
    errors.username = messages.usernameRequired;
  }

  if (!form.password) {
    errors.password = messages.passwordRequired;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function formatLastSynced(
  lastSyncedAt: Date | string | null | undefined,
  locale: string,
  neverSyncedLabel: string,
): string {
  if (!lastSyncedAt) {
    return neverSyncedLabel;
  }

  const date = typeof lastSyncedAt === 'string' ? new Date(lastSyncedAt) : lastSyncedAt;
  if (Number.isNaN(date.getTime())) {
    return neverSyncedLabel;
  }

  try {
    return new Intl.DateTimeFormat(locale === 'de' ? 'de-DE' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
