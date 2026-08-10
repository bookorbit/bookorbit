ALTER TABLE "book_series" ADD COLUMN "expected_book_count" integer;--> statement-breakpoint
ALTER TABLE "book_series" ADD COLUMN "expected_book_count_source" varchar(50);--> statement-breakpoint
ALTER TABLE "book_series" ADD COLUMN "expected_book_count_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book_series" ADD CONSTRAINT "book_series_expected_book_count_range_chk" CHECK ("book_series"."expected_book_count" IS NULL OR ("book_series"."expected_book_count" >= 1 AND "book_series"."expected_book_count" <= 10000));