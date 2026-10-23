CREATE TABLE "external_calendar_busy_intervals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(20) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"external_id" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_calendar_busy_intervals_provider_check" CHECK (provider IN ('google', 'caldav'))
);
--> statement-breakpoint
ALTER TABLE "google_oauth_tokens" ADD COLUMN "calendar_sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "google_oauth_tokens" ADD COLUMN "selected_calendar_id" varchar(255) DEFAULT 'primary';--> statement-breakpoint
ALTER TABLE "google_oauth_tokens" ADD COLUMN "last_calendar_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "google_oauth_tokens" ADD COLUMN "last_calendar_sync_error" text;--> statement-breakpoint
CREATE INDEX "external_calendar_busy_intervals_starts_at_idx" ON "external_calendar_busy_intervals" USING btree ("starts_at","ends_at");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "external_calendar_busy_intervals" TO "ownlight_app";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_migrator') THEN
    GRANT ALL ON "external_calendar_busy_intervals" TO "ownlight_migrator";
  END IF;
END
$$;