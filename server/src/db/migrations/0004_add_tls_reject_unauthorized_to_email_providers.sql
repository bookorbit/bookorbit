ALTER TABLE "achievements" DROP CONSTRAINT "achievements_category_chk";--> statement-breakpoint
ALTER TABLE "email_providers" ADD COLUMN "tls_reject_unauthorized" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_category_chk" CHECK ("achievements"."category" in ('reading', 'library', 'exploration', 'dedication'));