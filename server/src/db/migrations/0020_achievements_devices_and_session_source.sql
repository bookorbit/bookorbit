ALTER TABLE "achievements" DROP CONSTRAINT "achievements_category_chk";--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "source" varchar(10) DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_source_chk" CHECK ("reading_sessions"."source" in ('web', 'kobo', 'koreader'));--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_category_chk" CHECK ("achievements"."category" in ('reading', 'library', 'exploration', 'dedication', 'devices'));