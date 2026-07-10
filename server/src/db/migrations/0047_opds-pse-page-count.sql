-- Idempotent: on this project's live DB the page_count column was already applied
-- under an earlier migration number before the upstream rebase renumbered it here,
-- so guard both statements to no-op when the column/constraint already exist while
-- remaining correct on a fresh database.
ALTER TABLE "book_files" ADD COLUMN IF NOT EXISTS "page_count" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "book_files" ADD CONSTRAINT "book_files_page_count_nonnegative_chk" CHECK ("book_files"."page_count" is null or "book_files"."page_count" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
