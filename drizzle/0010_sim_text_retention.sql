ALTER TABLE "sim_messages" ALTER COLUMN "text" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sim_messages" ADD COLUMN "synthetic" boolean DEFAULT false NOT NULL;