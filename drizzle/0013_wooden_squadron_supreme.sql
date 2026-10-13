CREATE TABLE "inquiry_pow_replays" (
	"signature_hash" char(64) PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "forms_pow_hmac_key" text;