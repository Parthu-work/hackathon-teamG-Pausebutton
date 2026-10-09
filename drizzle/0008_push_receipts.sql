ALTER TABLE "push_deliveries" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD COLUMN "shown_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD COLUMN "display_error" text;