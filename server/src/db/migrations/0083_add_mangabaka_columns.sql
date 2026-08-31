ALTER TABLE "book_metadata" ADD COLUMN IF NOT EXISTS "mangabaka_id" varchar(50);--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN IF NOT EXISTS "mangabaka_series_id" varchar(50);