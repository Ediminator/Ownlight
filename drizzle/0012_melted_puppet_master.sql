CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"form_id" uuid NOT NULL,
	"notice_version_id" uuid NOT NULL,
	"notice_acknowledged_at" timestamp with time zone NOT NULL,
	"status" varchar(16) DEFAULT 'new' NOT NULL,
	"verification" varchar(16) NOT NULL,
	"delivery_mode" varchar(16) NOT NULL,
	"locale" varchar(8) NOT NULL,
	"given_name" varchar(100),
	"family_name" varchar(100),
	"email" varchar(255),
	"email_normalized" varchar(255),
	"phone" varchar(50),
	"event_type_key" varchar(40),
	"event_date" varchar(100),
	"event_location" varchar(200),
	"message" text,
	"auto_reply_status" varchar(16) DEFAULT 'not_applicable' NOT NULL,
	"converted_at" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_status_check" CHECK (status IN ('new', 'contacted', 'converted', 'archived', 'spam')),
	CONSTRAINT "leads_verification_check" CHECK (verification IN ('verified', 'unverified')),
	CONSTRAINT "leads_delivery_mode_check" CHECK (delivery_mode IN ('hosted', 'embed', 'script_free')),
	CONSTRAINT "leads_locale_check" CHECK (locale IN ('en', 'de')),
	CONSTRAINT "leads_auto_reply_status_check" CHECK (auto_reply_status IN ('not_applicable', 'queued', 'sent', 'failed', 'suppressed', 'disabled', 'pending')),
	CONSTRAINT "leads_converted_client_id_check" CHECK ((status = 'converted') = (client_id IS NOT NULL)),
	CONSTRAINT "leads_converted_or_name_email_check" CHECK (status = 'converted' OR (given_name IS NOT NULL AND email IS NOT NULL)),
	CONSTRAINT "leads_message_length_check" CHECK (message IS NULL OR length(message) <= 2000)
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_form_id_inquiry_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."inquiry_forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_notice_version_id_inquiry_form_notice_versions_id_fk" FOREIGN KEY ("notice_version_id") REFERENCES "public"."inquiry_form_notice_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_status_received_at_idx" ON "leads" USING btree ("status","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_email_normalized_idx" ON "leads" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "leads_client_id_idx" ON "leads" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "leads_last_activity_at_idx" ON "leads" USING btree ("last_activity_at");