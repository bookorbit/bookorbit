ALTER TABLE "reading_attempts" DROP CONSTRAINT "reading_attempts_book_id_books_id_fk";
--> statement-breakpoint
ALTER TABLE "reading_attempts" ALTER COLUMN "book_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "rating" smallint;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_title_snapshot" varchar(1000);--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_authors_snapshot" text;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_format_snapshot" varchar(20);--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_page_count_snapshot" integer;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_library_id_snapshot" integer;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD COLUMN "book_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD CONSTRAINT "reading_attempts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD CONSTRAINT "reading_attempts_rating_range_chk" CHECK ("reading_attempts"."rating" is null or ("reading_attempts"."rating" >= 1 and "reading_attempts"."rating" <= 5));