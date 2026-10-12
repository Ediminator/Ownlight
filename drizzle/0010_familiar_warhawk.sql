CREATE TABLE "google_contacts_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"google_resource_name" text NOT NULL,
	"google_etag" text NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_contacts_links_contact_id_unique" UNIQUE("contact_id")
);
--> statement-breakpoint
CREATE TABLE "google_contacts_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contact_id" uuid,
	"action" varchar(16) NOT NULL,
	"payload" jsonb,
	"status" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_contacts_outbox_action_check" CHECK (action IN ('UPSERT', 'DELETE')),
	CONSTRAINT "google_contacts_outbox_status_check" CHECK (status IN ('PENDING', 'PROCESSING', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "google_contacts_sync_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "google_contacts_links" ADD CONSTRAINT "google_contacts_links_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_contacts_outbox" ADD CONSTRAINT "google_contacts_outbox_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_contacts_outbox_status_next_attempt_idx" ON "google_contacts_outbox" USING btree ("status","next_attempt_at");