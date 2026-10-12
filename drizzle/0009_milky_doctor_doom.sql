CREATE TABLE "google_oauth_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(50) DEFAULT 'google' NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"access_token" text,
	"access_token_expires_at" timestamp with time zone,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_oauth_tokens_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "google_oauth_tokens" TO "ownlight_app";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_migrator') THEN
    GRANT ALL ON "google_oauth_tokens" TO "ownlight_migrator";
  END IF;
END
$$;
