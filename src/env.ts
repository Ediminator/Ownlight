import { z } from 'zod';

/**
 * Forbidden placeholder or weak substrings for secret validation.
 * Matching is case-insensitive.
 */
const FORBIDDEN_PLACEHOLDER_SUBSTRINGS = [
  'changeme',
  'password',
  'secret',
  'admin',
  'placeholder',
  '123456',
  'default',
  'example',
];

/**
 * Custom Error class for environment validation failures.
 * Guarantees that secret values are NEVER printed in the message or stack trace.
 */
export class EnvValidationError extends Error {
  public readonly issues: readonly { key: string; message: string }[];

  constructor(issues: readonly { key: string; message: string }[]) {
    const formatted = issues.map((i) => `  - ${i.key}: ${i.message}`).join('\n');
    super(
      `❌ Environment validation failed:\n${formatted}\nSecrets and credential values are omitted for security.`,
    );
    this.name = 'EnvValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

/**
 * Validates secret strength and entropy.
 * Fails fast on missing, weak, low-entropy, or placeholder values.
 * Never interpolates the secret value into error messages.
 */
export function validateSecretStrength(secret: unknown, keyName: string): void {
  if (typeof secret !== 'string' || !secret) {
    throw new Error(`Environment variable ${keyName} is required.`);
  }

  const trimmed = secret.trim();
  const lower = trimmed.toLowerCase();

  for (const forbidden of FORBIDDEN_PLACEHOLDER_SUBSTRINGS) {
    if (lower.includes(forbidden)) {
      throw new Error(
        `Environment variable ${keyName} contains forbidden placeholder or weak pattern.`,
      );
    }
  }

  // Unique character diversity check
  const uniqueChars = new Set(trimmed);
  if (uniqueChars.size < 8) {
    throw new Error(
      `Environment variable ${keyName} has insufficient entropy (low character diversity).`,
    );
  }

  // Check hex encoding (64 characters = 32 bytes)
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed);
  if (isHex) {
    if (trimmed.length < 64) {
      throw new Error(
        `Environment variable ${keyName} is hex-encoded but must be at least 64 characters (32 bytes).`,
      );
    }
    return;
  }

  // Check base64 encoding (44 characters ~= 32 bytes)
  const isBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);
  if (isBase64 && trimmed.length >= 40) {
    let decoded: Buffer | null = null;
    try {
      decoded = Buffer.from(trimmed, 'base64');
    } catch {
      decoded = null;
    }

    if (decoded && decoded.byteLength < 32) {
      throw new Error(
        `Environment variable ${keyName} is base64-encoded but must decode to at least 32 bytes.`,
      );
    }
    if (decoded && decoded.byteLength >= 32) {
      return;
    }
  }

  // Raw byte length check
  const byteLength = Buffer.byteLength(trimmed, 'utf8');
  if (byteLength < 32) {
    throw new Error(`Environment variable ${keyName} must be at least 32 bytes in length.`);
  }
}

/**
 * Formats Zod errors into an EnvValidationError without leaking any input values.
 */
function formatZodError(error: z.ZodError): EnvValidationError {
  const issues = error.issues.map((issue) => {
    const key = issue.path.join('.') || 'unknown';
    // Use the explicit issue message without echoing back input values
    return {
      key,
      message: issue.message,
    };
  });
  return new EnvValidationError(issues);
}

/**
 * Server-only environment schema.
 * All sensitive keys and server configurations live here.
 */
export const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  AUTH_URL: z.string({ required_error: 'AUTH_URL is required.' }).url({
    message: 'AUTH_URL must be a valid URL.',
  }),
  AUTH_SECRET: z.string({ required_error: 'AUTH_SECRET is required.' }).superRefine((val, ctx) => {
    try {
      validateSecretStrength(val, 'AUTH_SECRET');
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: err instanceof Error ? err.message : 'Invalid AUTH_SECRET',
      });
    }
  }),
  SETUP_TOKEN: z
    .string()
    .optional()
    .superRefine((val, ctx) => {
      if (val !== undefined && val !== '') {
        try {
          validateSecretStrength(val, 'SETUP_TOKEN');
        } catch (err) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: err instanceof Error ? err.message : 'Invalid SETUP_TOKEN',
          });
        }
      }
    }),

  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required.' })
    .regex(/^postgres(ql)?:\/\/.+/, {
      message: 'DATABASE_URL must be a valid PostgreSQL connection URL.',
    }),
  MIGRATION_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, {
      message: 'MIGRATION_DATABASE_URL must be a valid PostgreSQL connection URL.',
    })
    .optional(),
  DATABASE_MIGRATOR_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, {
      message: 'DATABASE_MIGRATOR_URL must be a valid PostgreSQL connection URL.',
    })
    .optional(),
  DB_MAX_CONNECTIONS: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT: z.coerce.number().int().positive().default(30),
  DB_SSL: z
    .enum(['true', 'false', 'require', 'prefer'])
    .default('false')
    .transform((val) => val === 'true' || val === 'require'),

  // Reverse proxy configuration (TASK-0023)
  TRUSTED_PROXY_COUNT: z.preprocess(
    (val) => {
      if (val === undefined || val === null) return 1;
      if (typeof val === 'string' && val.trim() === '') return 1;
      return val;
    },
    z.coerce
      .number({
        invalid_type_error: 'TRUSTED_PROXY_COUNT must be an integer in the allowed range 0-5',
      })
      .int({ message: 'TRUSTED_PROXY_COUNT must be an integer in the allowed range 0-5' })
      .min(0, { message: 'TRUSTED_PROXY_COUNT must be an integer in the allowed range 0-5' })
      .max(5, { message: 'TRUSTED_PROXY_COUNT must be an integer in the allowed range 0-5' }),
  ),

  // Retention framework configuration
  RETENTION_PERIOD_MONTHS: z.coerce.number().int().positive().default(24),
  CONSENT_PROOF_RETENTION_MONTHS: z.coerce.number().int().positive().default(36),
  CLIENT_RETENTION_MONTHS: z.preprocess(
    (val) => (val === undefined || val === '' ? 36 : val),
    z.coerce
      .number({
        invalid_type_error: 'CLIENT_RETENTION_MONTHS must be an integer >= 1',
      })
      .int({ message: 'CLIENT_RETENTION_MONTHS must be an integer >= 1' })
      .min(1, { message: 'CLIENT_RETENTION_MONTHS must be an integer >= 1' }),
  ),
  DATABASE_RETENTION_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, {
      message: 'DATABASE_RETENTION_URL must be a valid PostgreSQL connection URL.',
    })
    .optional(),

  // Local dev credentials & ports (Docker Compose)
  POSTGRES_DB: z.string().default('ownlight_dev'),
  POSTGRES_USER: z.string().default('postgres'),
  POSTGRES_PASSWORD: z.string().optional(),
  POSTGRES_APP_USER: z.string().default('ownlight_app'),
  POSTGRES_APP_PASSWORD: z.string().optional(),
  POSTGRES_MIGRATOR_USER: z.string().default('ownlight_migrator'),
  POSTGRES_MIGRATOR_PASSWORD: z.string().optional(),
  POSTGRES_PORT: z.coerce.number().int().default(5432),

  // Mailpit / SMTP
  SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z
    .string()
    .email({ message: 'SMTP_FROM must be a valid email address.' })
    .default('noreply@example.com'),
  MAILPIT_SMTP_PORT: z.coerce.number().int().default(1025),
  MAILPIT_HTTP_PORT: z.coerce.number().int().default(8025),

  // Object Storage (MinIO)
  STORAGE_ENDPOINT: z
    .string()
    .url({ message: 'STORAGE_ENDPOINT must be a valid URL.' })
    .default('http://127.0.0.1:9000'),
  STORAGE_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_ACCESS_KEY: z
    .string({ required_error: 'STORAGE_ACCESS_KEY is required.' })
    .min(1, { message: 'STORAGE_ACCESS_KEY cannot be empty.' }),
  STORAGE_SECRET_KEY: z
    .string({ required_error: 'STORAGE_SECRET_KEY is required.' })
    .min(8, { message: 'STORAGE_SECRET_KEY must be at least 8 characters.' })
    .superRefine((val, ctx) => {
      try {
        validateSecretStrength(val, 'STORAGE_SECRET_KEY');
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err instanceof Error ? err.message : 'Invalid STORAGE_SECRET_KEY',
        });
      }
    }),
  STORAGE_BUCKET_UPLOADS: z.string().min(1).default('ownlight-uploads'),
  STORAGE_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((val) => val === 'true'),
  MINIO_PORT: z.coerce.number().int().default(9000),
  MINIO_CONSOLE_PORT: z.coerce.number().int().default(9001),

  // Credential vault & external integrations (ADR-0014)
  ENCRYPTION_KEY: z
    .string()
    .optional()
    .superRefine((val, ctx) => {
      if (val !== undefined && val !== '') {
        try {
          validateSecretStrength(val, 'ENCRYPTION_KEY');
        } catch (err) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: err instanceof Error ? err.message : 'Invalid ENCRYPTION_KEY',
          });
          return;
        }

        const isHex = /^[0-9a-fA-F]{64}$/.test(val);
        const isBase64 = /^[A-Za-z0-9+/]{43}=$/.test(val) || /^[A-Za-z0-9+/]{44}$/.test(val);
        let base64Bytes = 0;
        if (isBase64) {
          try {
            base64Bytes = Buffer.from(val, 'base64').byteLength;
          } catch {
            base64Bytes = 0;
          }
        }

        if (!isHex && (!isBase64 || base64Bytes !== 32)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'ENCRYPTION_KEY must be a 32-byte secret encoded as 64 hex characters or 44 base64 characters.',
          });
        }
      }
    }),
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Client-safe environment schema.
 * STRICTLY restricted to keys beginning with NEXT_PUBLIC_.
 */
export const clientSchema = z
  .object({
    NEXT_PUBLIC_APP_URL: z
      .string()
      .url({ message: 'NEXT_PUBLIC_APP_URL must be a valid URL.' })
      .default('http://localhost:3000'),
    NEXT_PUBLIC_DEFAULT_LOCALE: z
      .enum(['en', 'de'], {
        message: 'NEXT_PUBLIC_DEFAULT_LOCALE must be either "en" or "de".',
      })
      .default('en'),
  })
  .strict();

export type ClientEnv = z.infer<typeof clientSchema>;

/**
 * Validates server environment variables from an input record.
 */
export function validateServerEnv(
  rawEnv: Record<string, string | undefined> = process.env,
): ServerEnv {
  const result = serverSchema.safeParse(rawEnv);
  if (!result.success) {
    throw formatZodError(result.error);
  }
  return Object.freeze(result.data);
}

/**
 * Validates client environment variables from an input record.
 * Isolates and extracts ONLY keys that begin with NEXT_PUBLIC_.
 */
export function validateClientEnv(
  rawEnv: Record<string, string | undefined> = process.env,
): ClientEnv {
  const filtered: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (key.startsWith('NEXT_PUBLIC_')) {
      Object.assign(filtered, { [key]: value });
    }
  }

  const result = clientSchema.safeParse(filtered);
  if (!result.success) {
    throw formatZodError(result.error);
  }
  return Object.freeze(result.data);
}

let cachedServerEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  cachedServerEnv ??= validateServerEnv(process.env);
  return cachedServerEnv;
}

export function resetEnvCache(): void {
  cachedServerEnv = null;
}

const NUMERIC_ENV_DEFAULTS: Record<string, number> = {
  PORT: 3000,
  RETENTION_PERIOD_MONTHS: 24,
  CONSENT_PROOF_RETENTION_MONTHS: 36,
  DB_MAX_CONNECTIONS: 10,
  DB_STATEMENT_TIMEOUT: 30,
  TRUSTED_PROXY_COUNT: 1,
};

/**
 * Server environment proxy.
 * Blocks access if imported in browser / client runtime.
 */
export const env: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    if (typeof window !== 'undefined') {
      throw new Error(
        'Server environment variables cannot be accessed on the client. Only NEXT_PUBLIC_* variables are accessible.',
      );
    }
    if (process.env.SKIP_ENV_VALIDATION === 'true') {
      const defaultNum = NUMERIC_ENV_DEFAULTS[prop];
      if (defaultNum !== undefined) {
        const raw = Number(process.env[prop]);
        return Number.isFinite(raw) && raw >= (prop === 'TRUSTED_PROXY_COUNT' ? 0 : 1)
          ? raw
          : defaultNum;
      }
      return process.env[prop] ?? '';
    }
    return getServerEnv()[prop as keyof ServerEnv];
  },
});

/**
 * Client environment instance.
 * Safe to access in both server and client contexts.
 */
export const clientEnv: ClientEnv = validateClientEnv(process.env);

// Module-level startup check:
// Unless SKIP_ENV_VALIDATION is set (e.g. during static build container step),
// trigger validation immediately when the module loads.
// If environment variables are missing during module evaluation (e.g. E2E tests),
// allow module evaluation to succeed and defer validation until runtime property access.
try {
  if (
    process.env.SKIP_ENV_VALIDATION !== 'true' &&
    process.env.NODE_ENV !== 'test' &&
    process.env.NEXT_PHASE !== 'phase-production-build' &&
    process.env.npm_lifecycle_event !== 'build'
  ) {
    getServerEnv();
  }
} catch {
  // Deferred to runtime property access
}

/**
 * Checks whether Google OAuth 2.0 integration and credential vault are fully configured.
 * Returns true only when ENCRYPTION_KEY, GOOGLE_OAUTH_CLIENT_ID, and GOOGLE_OAUTH_CLIENT_SECRET are all provided.
 */
export function isGoogleOAuthConfigured(envSource?: Partial<ServerEnv>): boolean {
  let encryptionKey = envSource?.ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;
  let clientId = envSource?.GOOGLE_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  let clientSecret =
    envSource?.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  if (!encryptionKey || !clientId || !clientSecret) {
    try {
      encryptionKey ??= env.ENCRYPTION_KEY;
      clientId ??= env.GOOGLE_OAUTH_CLIENT_ID;
      clientSecret ??= env.GOOGLE_OAUTH_CLIENT_SECRET;
    } catch {
      // If server environment validation fails, Google OAuth is unconfigured
    }
  }

  return Boolean(
    encryptionKey &&
    encryptionKey.trim().length > 0 &&
    clientId &&
    clientId.trim().length > 0 &&
    clientSecret &&
    clientSecret.trim().length > 0,
  );
}
