ALTER TABLE "book_file_hash_history" DROP CONSTRAINT "book_file_hash_history_reason_chk";--> statement-breakpoint
ALTER TABLE "libraries" ADD COLUMN "koreader_hash_revision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "koreader_unmatched_books" ADD COLUMN "manual_link_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "book_files_change_timestamp_idx" ON "book_files" USING btree (greatest("created_at", "updated_at") desc);--> statement-breakpoint
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_reason_chk" CHECK ("book_file_hash_history"."reason" in ('file_write', 'external_change', 'rescan', 'kobo_download'));