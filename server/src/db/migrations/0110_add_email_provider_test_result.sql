ALTER TABLE "email_providers" ADD COLUMN "last_tested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_providers" ADD COLUMN "last_test_ok" boolean;--> statement-breakpoint
ALTER TABLE "email_providers" ADD COLUMN "last_test_error" text;