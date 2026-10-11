CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"purpose" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"effective_on" date NOT NULL,
	"method" varchar(20) NOT NULL,
	"scope" varchar(500),
	"evidence_note" varchar(500),
	"recorded_by_actor_type" varchar(20) NOT NULL,
	"recorded_by_actor_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_records_purpose_check" CHECK (purpose IN ('marketing', 'image_usage')),
	CONSTRAINT "consent_records_status_check" CHECK (status IN ('granted', 'withdrawn')),
	CONSTRAINT "consent_records_method_check" CHECK (method IN ('in_person', 'paper_form', 'email', 'phone', 'other')),
	CONSTRAINT "consent_records_actor_type_check" CHECK (recorded_by_actor_type IN ('owner', 'client', 'system', 'agent', 'token'))
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_records_contact_purpose_idx" ON "consent_records" USING btree ("contact_id","purpose","effective_on" DESC NULLS LAST,"created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_consent_records()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'consent_records rows cannot be updated';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS consent_records_immutable ON "consent_records";--> statement-breakpoint
CREATE TRIGGER consent_records_immutable
BEFORE UPDATE ON "consent_records"
FOR EACH ROW
EXECUTE FUNCTION protect_consent_records();--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_app') THEN
    REVOKE UPDATE ON "consent_records" FROM "ownlight_app";
    GRANT SELECT, INSERT, DELETE ON "consent_records" TO "ownlight_app";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_migrator') THEN
    GRANT ALL ON "consent_records" TO "ownlight_migrator";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_retention') THEN
    GRANT SELECT, DELETE ON "consent_records" TO "ownlight_retention";
    GRANT SELECT, DELETE ON "client_timeline_events" TO "ownlight_retention";
  END IF;
END
$$;