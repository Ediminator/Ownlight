CREATE TABLE "proposal_line_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"package_id" uuid,
	"catalogue_item_id" uuid,
	"item_type" varchar(20) DEFAULT 'addon' NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"unit_price_minor" bigint DEFAULT 0 NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"min_quantity" integer DEFAULT 0 NOT NULL,
	"max_quantity" integer DEFAULT 1 NOT NULL,
	"tax_rate_basis_points" integer DEFAULT 1900 NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"is_selected" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_line_items_item_type_check" CHECK (item_type IN ('base_package', 'addon', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"subtotal_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint DEFAULT 0 NOT NULL,
	"prices_include_tax" boolean DEFAULT true NOT NULL,
	"is_kleinunternehmer" boolean DEFAULT false NOT NULL,
	"tax_notice" text,
	"valid_until" timestamp with time zone,
	"token_hash" varchar(64) NOT NULL,
	"token_revoked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"accepted_by_name" varchar(200),
	"accepted_by_email" varchar(255),
	"acceptance_ip_anonymized" varchar(64),
	"acceptance_user_agent" varchar(255),
	"accepted_options_snapshot" jsonb,
	"internal_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposals_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "proposals_status_check" CHECK (status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "proposal_line_items" ADD CONSTRAINT "proposal_line_items_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_line_items" ADD CONSTRAINT "proposal_line_items_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_line_items" ADD CONSTRAINT "proposal_line_items_catalogue_item_id_catalogue_items_id_fk" FOREIGN KEY ("catalogue_item_id") REFERENCES "public"."catalogue_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_line_items_proposal_position_idx" ON "proposal_line_items" USING btree ("proposal_id","position");--> statement-breakpoint
CREATE INDEX "proposals_project_id_idx" ON "proposals" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "proposals_client_id_idx" ON "proposals" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "proposals_token_hash_idx" ON "proposals" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status");