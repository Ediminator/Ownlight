ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_outbox_proposal_id_idx" ON "email_outbox" USING btree ("proposal_id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK (kind IN ('lead_auto_reply', 'appointment_confirmation', 'appointment_cancellation', 'proposal_sent', 'proposal_accepted_client', 'proposal_accepted_owner'));