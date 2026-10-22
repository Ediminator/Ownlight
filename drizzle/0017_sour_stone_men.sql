ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "calendar_sync_outbox" DROP CONSTRAINT "calendar_sync_outbox_status_check";--> statement-breakpoint
ALTER TABLE "email_outbox" ALTER COLUMN "lead_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "recipient" varchar(255);--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_appointment_id_idx" ON "email_outbox" USING btree ("appointment_id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK (kind IN ('lead_auto_reply', 'appointment_confirmation', 'appointment_cancellation'));--> statement-breakpoint
ALTER TABLE "calendar_sync_outbox" ADD CONSTRAINT "calendar_sync_outbox_status_check" CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'));