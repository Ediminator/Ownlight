CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_type_id" uuid,
	"client_id" uuid,
	"project_id" uuid,
	"lead_id" uuid,
	"title" varchar(200) NOT NULL,
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) DEFAULT 'Europe/Berlin' NOT NULL,
	"attendee_name" varchar(200) NOT NULL,
	"attendee_email" varchar(255) NOT NULL,
	"attendee_phone" varchar(50),
	"attendee_notes" text,
	"location_type" varchar(20) DEFAULT 'google_meet' NOT NULL,
	"location_details" varchar(255),
	"meet_url" varchar(500),
	"cancellation_reason" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_location_type_check" CHECK (location_type IN ('in_person', 'phone', 'google_meet')),
	CONSTRAINT "appointments_status_check" CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show'))
);
--> statement-breakpoint
CREATE TABLE "availability_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"date" varchar(10) NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"is_unavailable" boolean DEFAULT false NOT NULL,
	"reason" varchar(150),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_overrides_date_start_time_unique" UNIQUE("date","start_time")
);
--> statement-breakpoint
CREATE TABLE "availability_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" varchar(5) NOT NULL,
	"end_time" varchar(5) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_schedules_day_of_week_check" CHECK (day_of_week >= 0 AND day_of_week <= 6)
);
--> statement-breakpoint
CREATE TABLE "blocked_time" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" varchar(200) DEFAULT 'Blocked Time' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"title" varchar(150) NOT NULL,
	"description" text,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 15 NOT NULL,
	"min_notice_hours" integer DEFAULT 24 NOT NULL,
	"max_future_days" integer DEFAULT 60 NOT NULL,
	"location_type" varchar(20) DEFAULT 'google_meet' NOT NULL,
	"location_details" varchar(255),
	"color" varchar(32) DEFAULT 'indigo' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_types_slug_unique" UNIQUE("slug"),
	CONSTRAINT "booking_types_location_type_check" CHECK (location_type IN ('in_person', 'phone', 'google_meet'))
);
--> statement-breakpoint
CREATE TABLE "caldav_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"server_url" varchar(500) NOT NULL,
	"username" varchar(255) NOT NULL,
	"encrypted_password" text NOT NULL,
	"calendar_home_url" varchar(500),
	"selected_calendar_url" varchar(500),
	"selected_calendar_name" varchar(255),
	"ctag" varchar(255),
	"sync_token" varchar(500),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"name" varchar(100) DEFAULT 'Main Studio Feed' NOT NULL,
	"summary_level" varchar(20) DEFAULT 'standard' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "calendar_feeds_summary_level_check" CHECK (summary_level IN ('minimal', 'standard', 'full'))
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(20) NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"external_event_id" varchar(500) NOT NULL,
	"etag" varchar(255),
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_links_provider_entity_unique" UNIQUE("provider","entity_type","entity_id"),
	CONSTRAINT "calendar_sync_links_provider_check" CHECK (provider IN ('google', 'caldav')),
	CONSTRAINT "calendar_sync_links_entity_type_check" CHECK (entity_type IN ('shoot', 'appointment', 'blocked_time'))
);
--> statement-breakpoint
CREATE TABLE "calendar_sync_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_sync_outbox_entity_type_check" CHECK (entity_type IN ('shoot', 'appointment', 'blocked_time')),
	CONSTRAINT "calendar_sync_outbox_action_check" CHECK (action IN ('create', 'update', 'delete')),
	CONSTRAINT "calendar_sync_outbox_status_check" CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booking_type_id_booking_types_id_fk" FOREIGN KEY ("booking_type_id") REFERENCES "public"."booking_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_starts_at_idx" ON "appointments" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "appointments_client_id_idx" ON "appointments" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "appointments_project_id_idx" ON "appointments" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "appointments_status_idx" ON "appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "blocked_time_starts_at_idx" ON "blocked_time" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "calendar_sync_outbox_status_next_attempt_idx" ON "calendar_sync_outbox" USING btree ("status","next_attempt_at");