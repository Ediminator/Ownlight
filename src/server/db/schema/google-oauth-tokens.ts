import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { generateUuidV7 } from '@/lib/id';

/**
 * Google OAuth 2.0 tokens table (ADR-0008, ADR-0014, TASK-0017).
 *
 * Stores studio-level OAuth tokens for Google Workspace integrations.
 * Refresh tokens are encrypted at rest with the credential vault (ownlight:vault:google_oauth).
 * Plaintext refresh tokens NEVER touch the database or disk.
 */
export const googleOAuthTokens = pgTable('google_oauth_tokens', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => generateUuidV7()),
  provider: varchar('provider', { length: 50 }).notNull().default('google').unique(),
  encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', {
    withTimezone: true,
    mode: 'date',
  }),
  scope: text('scope').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type GoogleOAuthToken = typeof googleOAuthTokens.$inferSelect;
export type NewGoogleOAuthToken = typeof googleOAuthTokens.$inferInsert;
