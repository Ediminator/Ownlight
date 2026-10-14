CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" varchar(32) NOT NULL,
	"name" varchar(100) NOT NULL,
	"position" integer NOT NULL,
	"category" varchar(20) NOT NULL,
	"color" varchar(32) DEFAULT 'neutral' NOT NULL,
	"is_system" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_stages_key_unique" UNIQUE("key"),
	CONSTRAINT "pipeline_stages_position_unique" UNIQUE("position"),
	CONSTRAINT "pipeline_stages_category_check" CHECK (category IN ('inquiry', 'booked', 'in_progress', 'review', 'completed', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "project_participants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"contact_id" uuid,
	"name" varchar(200),
	"email" varchar(255),
	"phone" varchar(50),
	"role" varchar(100) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_participants_contact_or_name_check" CHECK ((contact_id IS NOT NULL) OR (name IS NOT NULL AND length(trim(name)) > 0))
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"stage_id" uuid,
	"title" varchar(255) NOT NULL,
	"is_completed" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"due_date" timestamp with time zone,
	"order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"project_type_key" varchar(40) DEFAULT 'general' NOT NULL,
	"lead_id" uuid,
	"primary_shoot_starts_at" timestamp with time zone,
	"primary_shoot_timezone" varchar(64),
	"currency" char(3) DEFAULT 'EUR' NOT NULL,
	"price_minor" bigint,
	"notes" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shoot_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shoot_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"address_line1" varchar(200),
	"address_line2" varchar(200),
	"postal_code" varchar(20),
	"city" varchar(100),
	"country_code" char(2),
	"notes" text,
	"order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shoot_timeline_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shoot_id" uuid NOT NULL,
	"location_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"title" varchar(200) NOT NULL,
	"description" text,
	"order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shoots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"title" varchar(200) DEFAULT 'Shoot' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"timezone" varchar(64) DEFAULT 'Europe/Berlin' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_task_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stage_id" uuid NOT NULL,
	"project_type_key" varchar(40),
	"title" varchar(255) NOT NULL,
	"order" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_participants" ADD CONSTRAINT "project_participants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_participants" ADD CONSTRAINT "project_participants_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_locations" ADD CONSTRAINT "shoot_locations_shoot_id_shoots_id_fk" FOREIGN KEY ("shoot_id") REFERENCES "public"."shoots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_timeline_items" ADD CONSTRAINT "shoot_timeline_items_shoot_id_shoots_id_fk" FOREIGN KEY ("shoot_id") REFERENCES "public"."shoots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoot_timeline_items" ADD CONSTRAINT "shoot_timeline_items_location_id_shoot_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."shoot_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shoots" ADD CONSTRAINT "shoots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_task_templates" ADD CONSTRAINT "stage_task_templates_stage_id_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."pipeline_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_participants_project_id_idx" ON "project_participants" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_participants_contact_id_idx" ON "project_participants" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "project_tasks_project_id_idx" ON "project_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_tasks_stage_id_idx" ON "project_tasks" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "projects_client_id_idx" ON "projects" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "projects_stage_id_idx" ON "projects" USING btree ("stage_id");--> statement-breakpoint
CREATE INDEX "projects_primary_shoot_starts_at_idx" ON "projects" USING btree ("primary_shoot_starts_at");--> statement-breakpoint
CREATE INDEX "projects_last_activity_at_idx" ON "projects" USING btree ("last_activity_at");--> statement-breakpoint
CREATE INDEX "shoot_locations_shoot_id_idx" ON "shoot_locations" USING btree ("shoot_id");--> statement-breakpoint
CREATE INDEX "shoot_timeline_items_shoot_id_idx" ON "shoot_timeline_items" USING btree ("shoot_id");--> statement-breakpoint
CREATE INDEX "shoot_timeline_items_starts_at_idx" ON "shoot_timeline_items" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "shoots_project_id_idx" ON "shoots" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "shoots_starts_at_idx" ON "shoots" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "stage_task_templates_stage_id_idx" ON "stage_task_templates" USING btree ("stage_id");--> statement-breakpoint
INSERT INTO "pipeline_stages" ("id", "key", "name", "position", "category", "color", "is_system", "created_at", "updated_at") VALUES
('01920000-0000-7000-8000-000000000001', 'inquiry', 'Inquiry', 1, 'inquiry', 'slate', true, now(), now()),
('01920000-0000-7000-8000-000000000002', 'booked', 'Booked', 2, 'booked', 'blue', true, now(), now()),
('01920000-0000-7000-8000-000000000003', 'shot', 'Shot', 3, 'in_progress', 'amber', true, now(), now()),
('01920000-0000-7000-8000-000000000004', 'editing', 'Editing', 4, 'review', 'purple', true, now(), now()),
('01920000-0000-7000-8000-000000000005', 'delivered', 'Delivered', 5, 'completed', 'emerald', true, now(), now()),
('01920000-0000-7000-8000-000000000006', 'archived', 'Archived', 6, 'archived', 'zinc', true, now(), now())
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "stage_task_templates" ("id", "stage_id", "project_type_key", "title", "order", "created_at", "updated_at") VALUES
('01920000-0000-7000-8000-000000000011', '01920000-0000-7000-8000-000000000001', NULL, 'Send pricing guide', 1, now(), now()),
('01920000-0000-7000-8000-000000000012', '01920000-0000-7000-8000-000000000002', NULL, 'Countersign contract', 1, now(), now()),
('01920000-0000-7000-8000-000000000013', '01920000-0000-7000-8000-000000000003', NULL, 'Ingest RAW cards & create 3-2-1 backup', 1, now(), now()),
('01920000-0000-7000-8000-000000000014', '01920000-0000-7000-8000-000000000004', NULL, 'Cull photos', 1, now(), now()),
('01920000-0000-7000-8000-000000000015', '01920000-0000-7000-8000-000000000005', NULL, 'Deliver online gallery', 1, now(), now()),
('01920000-0000-7000-8000-000000000016', '01920000-0000-7000-8000-000000000006', NULL, 'Archive raw files to cold storage', 1, now(), now())
ON CONFLICT ("id") DO NOTHING;