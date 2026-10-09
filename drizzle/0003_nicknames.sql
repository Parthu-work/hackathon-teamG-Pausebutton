ALTER TABLE "users" ADD COLUMN "nickname" text;--> statement-breakpoint
UPDATE "users" SET "nickname" = 'Papa' WHERE "demo_key" = 'rao';
