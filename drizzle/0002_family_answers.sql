CREATE TABLE "answers" (
	"id" text PRIMARY KEY NOT NULL,
	"check_id" text NOT NULL,
	"member_id" text NOT NULL,
	"verdict" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answers_check_member" UNIQUE("check_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_check_id_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_member_id_users_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Keep answers given before this table existed.
INSERT INTO "answers" ("id", "check_id", "member_id", "verdict", "created_at")
SELECT gen_random_uuid()::text, "id", "family_verdict_by", "family_verdict", COALESCE("family_verdict_at", now())
FROM "checks" WHERE "family_verdict" IS NOT NULL AND "family_verdict_by" IS NOT NULL
ON CONFLICT DO NOTHING;
