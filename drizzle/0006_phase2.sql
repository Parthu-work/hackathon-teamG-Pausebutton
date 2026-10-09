CREATE TABLE "reported_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"reported_by_id" text,
	"reported_by_name" text NOT NULL,
	"check_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"auto_check" text NOT NULL,
	"auto_reason" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sightings" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"household_key" text NOT NULL,
	"family" text,
	"title" text NOT NULL,
	"domain" text,
	"synthetic" boolean DEFAULT false NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "ai_scam_type" text;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "novel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "checks" ADD COLUMN "call_answers" jsonb;--> statement-breakpoint
ALTER TABLE "reported_domains" ADD CONSTRAINT "reported_domains_reported_by_id_users_id_fk" FOREIGN KEY ("reported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reported_domains" ADD CONSTRAINT "reported_domains_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE set null ON UPDATE no action;