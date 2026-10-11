CREATE TABLE "client_timeline_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"type" varchar(100) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"actor_id" varchar(100),
	"subject_type" varchar(50),
	"subject_id" varchar(100),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_timeline_events_actor_type_check" CHECK (actor_type IN ('owner', 'client', 'system', 'agent', 'token'))
);
--> statement-breakpoint
CREATE TABLE "client_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_notes_body_len_check" CHECK (char_length(body) >= 1 AND char_length(body) <= 5000)
);
--> statement-breakpoint
ALTER TABLE "client_timeline_events" ADD CONSTRAINT "client_timeline_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_timeline_events_client_occurred_idx" ON "client_timeline_events" USING btree ("client_id","occurred_at" DESC,"id" DESC);--> statement-breakpoint
CREATE INDEX "client_notes_client_id_idx" ON "client_notes" USING btree ("client_id");--> statement-breakpoint
INSERT INTO "client_timeline_events" ("id", "client_id", "type", "occurred_at", "actor_type", "actor_id", "subject_type", "subject_id", "data", "created_at")
SELECT gen_random_uuid(), "id", 'client.created', "created_at", 'system', NULL, 'client', "id"::text, '{}'::jsonb, now()
FROM "clients";
