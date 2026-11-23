ALTER TABLE "book_duplicate_dismissals" DROP CONSTRAINT "book_duplicate_dismissals_kind_chk";--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" DROP CONSTRAINT "book_duplicate_groups_kind_chk";--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" DROP CONSTRAINT "book_duplicate_pairs_kind_chk";--> statement-breakpoint
ALTER TABLE "book_duplicate_scans" ADD COLUMN "total_other_edition_pairs" integer;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "original_published_year" integer;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "edition_name" varchar(500);--> statement-breakpoint
CREATE INDEX "bm_original_published_year_idx" ON "book_metadata" USING btree ("original_published_year");--> statement-breakpoint
ALTER TABLE "book_duplicate_dismissals" ADD CONSTRAINT "book_duplicate_dismissals_kind_chk" CHECK ("book_duplicate_dismissals"."kind" in ('duplicate', 'other_format', 'other_edition'));--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD CONSTRAINT "book_duplicate_groups_kind_chk" CHECK ("book_duplicate_groups"."kind" in ('duplicate', 'other_format', 'other_edition'));--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD CONSTRAINT "book_duplicate_pairs_kind_chk" CHECK ("book_duplicate_pairs"."kind" in ('duplicate', 'other_format', 'other_edition'));--> statement-breakpoint
ALTER TABLE "book_metadata" ADD CONSTRAINT "book_metadata_original_published_year_range_chk" CHECK ("book_metadata"."original_published_year" is null or ("book_metadata"."original_published_year" >= 1000 and "book_metadata"."original_published_year" <= 2200));