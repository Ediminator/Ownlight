CREATE TABLE "inquiry_form_notice_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"form_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"acknowledgement_text_en" varchar(500) NOT NULL,
	"acknowledgement_text_de" varchar(500) NOT NULL,
	"privacy_policy_url" varchar(2048) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_actor_id" text NOT NULL,
	CONSTRAINT "inquiry_form_notice_versions_form_id_version_unique" UNIQUE("form_id","version")
);
--> statement-breakpoint
CREATE TABLE "inquiry_forms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(16) NOT NULL,
	"name" varchar(100) NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"default_locale" varchar(8) DEFAULT 'en' NOT NULL,
	"fields" jsonb NOT NULL,
	"event_types" jsonb NOT NULL,
	"current_notice_version_id" uuid,
	"auto_reply_enabled" boolean DEFAULT true NOT NULL,
	"accept_unverified" boolean DEFAULT false NOT NULL,
	"success_redirect_url" varchar(2048),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inquiry_forms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "inquiry_forms_status_check" CHECK (status IN ('draft', 'published', 'archived')),
	CONSTRAINT "inquiry_forms_default_locale_check" CHECK (default_locale IN ('en', 'de'))
);
--> statement-breakpoint
ALTER TABLE "inquiry_form_notice_versions" ADD CONSTRAINT "inquiry_form_notice_versions_form_id_inquiry_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."inquiry_forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiry_forms" ADD CONSTRAINT "inquiry_forms_current_notice_version_id_inquiry_form_notice_versions_id_fk" FOREIGN KEY ("current_notice_version_id") REFERENCES "public"."inquiry_form_notice_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inquiry_form_notice_versions_form_id_idx" ON "inquiry_form_notice_versions" USING btree ("form_id");