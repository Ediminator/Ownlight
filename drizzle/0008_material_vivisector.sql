CREATE TABLE "client_legal_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"reason" varchar(50) NOT NULL,
	"note" varchar(500),
	"until" date,
	"set_by_actor_type" varchar(20) NOT NULL,
	"set_by_actor_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_legal_holds_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "client_legal_holds_reason_check" CHECK (reason IN ('dispute', 'statutory', 'other')),
	CONSTRAINT "client_legal_holds_actor_type_check" CHECK (set_by_actor_type IN ('owner', 'client', 'system', 'agent', 'token'))
);
--> statement-breakpoint
ALTER TABLE "client_legal_holds" ADD CONSTRAINT "client_legal_holds_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_legal_holds_client_id_idx" ON "client_legal_holds" USING btree ("client_id");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "client_legal_holds" TO "ownlight_app";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_migrator') THEN
    GRANT ALL ON "client_legal_holds" TO "ownlight_migrator";
  END IF;
  IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ownlight_retention') THEN
    GRANT SELECT, DELETE ON "client_legal_holds" TO "ownlight_retention";
    GRANT SELECT, DELETE ON "clients" TO "ownlight_retention";
    GRANT SELECT, DELETE ON "client_contacts" TO "ownlight_retention";
    GRANT SELECT, DELETE ON "client_addresses" TO "ownlight_retention";
    GRANT SELECT, DELETE ON "client_notes" TO "ownlight_retention";
    GRANT SELECT, DELETE ON "client_tags" TO "ownlight_retention";
    GRANT SELECT, DELETE ON "consent_records" TO "ownlight_retention";
    GRANT SELECT, DELETE ON "client_timeline_events" TO "ownlight_retention";
    GRANT SELECT ON "studio_settings" TO "ownlight_retention";
    GRANT SELECT, INSERT, DELETE ON "audit_events" TO "ownlight_retention";
    REVOKE UPDATE ON "client_legal_holds" FROM "ownlight_retention";
    REVOKE UPDATE ON "clients" FROM "ownlight_retention";
    REVOKE UPDATE ON "client_contacts" FROM "ownlight_retention";
    REVOKE UPDATE ON "client_addresses" FROM "ownlight_retention";
    REVOKE UPDATE ON "client_notes" FROM "ownlight_retention";
    REVOKE UPDATE ON "client_tags" FROM "ownlight_retention";
    REVOKE UPDATE ON "consent_records" FROM "ownlight_retention";
    REVOKE UPDATE ON "client_timeline_events" FROM "ownlight_retention";
  END IF;
END
$$;