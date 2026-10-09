CREATE TABLE "advice" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"hold_id" text,
	"from_user_id" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"hold_id" text,
	"recipient_id" text NOT NULL,
	"kind" text NOT NULL,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"sender_label" text,
	"title" text NOT NULL,
	"fingerprint" text NOT NULL,
	"verdict" text NOT NULL,
	"score" integer NOT NULL,
	"rules_score" integer NOT NULL,
	"model_score" integer,
	"hard_rule" text,
	"decided_by" text NOT NULL,
	"signals" jsonb NOT NULL,
	"hard_phrases" jsonb NOT NULL,
	"link" jsonb,
	"family" text,
	"amount" integer,
	"amount_text" text,
	"payee" text,
	"model_terms" jsonb NOT NULL,
	"ai_status" text NOT NULL,
	"ai_model" text,
	"degraded" boolean DEFAULT false NOT NULL,
	"safe_hint" text,
	"asked_family_at" timestamp with time zone,
	"family_verdict" text,
	"family_verdict_by" text,
	"family_verdict_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"hold_id" text,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"user_id" text NOT NULL,
	"payee" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"outcome_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"id" text PRIMARY KEY NOT NULL,
	"protected_id" text NOT NULL,
	"family_id" text,
	"name" text NOT NULL,
	"relation" text NOT NULL,
	"phone" text NOT NULL,
	"invite_code" text NOT NULL,
	"code_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"early_heads_up" boolean DEFAULT true NOT NULL,
	"linked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_invite_code_unique" UNIQUE("invite_code")
);
--> statement-breakpoint
CREATE TABLE "sim_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"sender" text NOT NULL,
	"from_contact" boolean DEFAULT false NOT NULL,
	"text" text NOT NULL,
	"check_id" text,
	"banner_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"summary" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"role" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"text_size" text DEFAULT 'A' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"watch_sms" boolean DEFAULT true NOT NULL,
	"watch_whatsapp" boolean DEFAULT true NOT NULL,
	"unknown_only" boolean DEFAULT true NOT NULL,
	"auto_tell_family" boolean DEFAULT true NOT NULL,
	"alert_notify" boolean DEFAULT true NOT NULL,
	"alert_sound" boolean DEFAULT true NOT NULL,
	"alert_vibrate" boolean DEFAULT true NOT NULL,
	"alerts_ready" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "advice" ADD CONSTRAINT "advice_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advice" ADD CONSTRAINT "advice_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advice" ADD CONSTRAINT "advice_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_hold_id_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."holds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checks" ADD CONSTRAINT "checks_family_verdict_by_users_id_fk" FOREIGN KEY ("family_verdict_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_protected_id_users_id_fk" FOREIGN KEY ("protected_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_family_id_users_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_messages" ADD CONSTRAINT "sim_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_messages" ADD CONSTRAINT "sim_messages_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE set null ON UPDATE no action;