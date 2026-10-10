CREATE TABLE "otp_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"shown_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rechecked" integer DEFAULT 0 NOT NULL,
	"recheck_failed" integer DEFAULT 0 NOT NULL,
	"repushed" integer DEFAULT 0 NOT NULL,
	"quiet_devices" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "repushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "not_syncing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "waiting" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "kind" text DEFAULT 'webpush' NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_messages" ADD COLUMN "device_message_id" text;--> statement-breakpoint
ALTER TABLE "sim_messages" ADD COLUMN "status" text DEFAULT 'checked' NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_messages" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "sim_messages" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_messages" ADD COLUMN "last_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hold_minutes" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
CREATE INDEX "otp_codes_phone" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_messages_device_message" ON "sim_messages" USING btree ("user_id","device_message_id");--> statement-breakpoint
UPDATE "sim_messages" SET "status" = 'skipped' WHERE "check_id" IS NULL;
