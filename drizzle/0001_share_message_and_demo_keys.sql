ALTER TABLE "checks" ADD COLUMN "message_text" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demo_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_demo_key_unique" UNIQUE("demo_key");--> statement-breakpoint
-- Tag demo personas seeded before demo_key existed (they were found by phone).
UPDATE "users" SET "demo_key" = 'rao' WHERE "is_demo" AND "phone" = '+91 98765 43210';--> statement-breakpoint
UPDATE "users" SET "demo_key" = 'arjun' WHERE "is_demo" AND "phone" = '+91 91234 56789';--> statement-breakpoint
UPDATE "users" SET "demo_key" = 'meera' WHERE "is_demo" AND "phone" = '+91 99887 76655';
