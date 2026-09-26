ALTER TABLE "book_files" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD COLUMN "captured_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD COLUMN "manifest_revision" varchar(64);--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "client_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "chapter_id" varchar(80);--> statement-breakpoint
CREATE UNIQUE INDEX "book_files_public_id_uidx" ON "book_files" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_book_client_id_uidx" ON "bookmarks" USING btree ("user_id","book_id","client_id");--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD CONSTRAINT "audiobook_progress_revision_positive_chk" CHECK ("audiobook_progress"."revision" >= 1);