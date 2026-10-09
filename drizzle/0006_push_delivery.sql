CREATE TABLE "push_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"household_id" text,
	"dedupe_key" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"devices" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_notifications_user_dedupe" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_notifications" ADD CONSTRAINT "push_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_notifications_retry" ON "push_notifications" USING btree ("household_id","status");