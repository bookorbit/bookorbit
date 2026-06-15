ALTER TABLE "reading_sessions" ALTER COLUMN "book_file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "book_id" integer;--> statement-breakpoint
ALTER TABLE "reading_sessions" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reading_sessions" ALTER COLUMN "source" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" DROP CONSTRAINT "reading_sessions_source_chk";--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rs_user_book_started_at_idx" ON "reading_sessions" USING btree ("user_id","book_id","started_at");--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_source_chk" CHECK ("reading_sessions"."source" in ('web', 'koreader', 'manual', 'kobo'));
