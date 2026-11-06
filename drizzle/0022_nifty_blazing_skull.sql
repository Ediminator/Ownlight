CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(150) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"description" text,
	"project_type_key" varchar(40),
	"content_en" text NOT NULL,
	"content_de" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"proposal_id" uuid,
	"template_id" uuid,
	"contract_number" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"locale" varchar(10) DEFAULT 'en' NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"rendered_body" text NOT NULL,
	"merge_values_snapshot" jsonb NOT NULL,
	"canonical_body_sha256" varchar(64) NOT NULL,
	"valid_until" timestamp with time zone,
	"token_hash" varchar(64) NOT NULL,
	"token_revoked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"client_signed_at" timestamp with time zone,
	"client_signer_name" varchar(200),
	"client_signer_email" varchar(255),
	"client_signature_type" varchar(20),
	"client_signature_data" text,
	"client_ip_anonymized" varchar(64),
	"client_user_agent" varchar(255),
	"studio_signed_at" timestamp with time zone,
	"studio_signer_name" varchar(200),
	"studio_signer_title" varchar(100),
	"studio_signature_data" text,
	"pdf_storage_key" varchar(255),
	"pdf_sha256" varchar(64),
	"pdf_byte_size" integer,
	"pdf_generated_at" timestamp with time zone,
	"internal_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_contract_number_unique" UNIQUE("contract_number"),
	CONSTRAINT "contracts_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "contracts_status_check" CHECK (status IN ('draft', 'sent', 'signed_by_client', 'signed', 'declined', 'voided', 'superseded')),
	CONSTRAINT "contracts_client_signature_type_check" CHECK (client_signature_type IS NULL OR client_signature_type IN ('drawn', 'typed'))
);
--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "contract_signatory_name" varchar(200);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "contract_signatory_title" varchar(100);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "contract_countersignature_mode" varchar(32) DEFAULT 'pre_signed' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "studio_address_line1" varchar(200);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "studio_address_line2" varchar(200);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "studio_postal_code" varchar(20);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "studio_city" varchar(100);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "studio_country_code" char(2) DEFAULT 'DE' NOT NULL;--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "studio_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "studio_settings" ADD COLUMN "studio_email" varchar(255);--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_templates_slug_idx" ON "contract_templates" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "contract_templates_project_type_key_idx" ON "contract_templates" USING btree ("project_type_key");--> statement-breakpoint
CREATE INDEX "contracts_project_id_idx" ON "contracts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "contracts_client_id_idx" ON "contracts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contracts_proposal_id_idx" ON "contracts" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "contracts_template_id_idx" ON "contracts" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "contracts_token_hash_idx" ON "contracts" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "contracts_status_idx" ON "contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contracts_contract_number_idx" ON "contracts" USING btree ("contract_number");