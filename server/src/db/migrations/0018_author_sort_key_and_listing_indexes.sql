ALTER TABLE "books" ADD COLUMN "primary_author_sort_name" varchar(500);--> statement-breakpoint
CREATE INDEX "books_library_visible_added_id_idx" ON "books" USING btree ("library_id","added_at" desc,"id") WHERE "books"."status" <> 'processing';--> statement-breakpoint
CREATE INDEX "books_library_author_sort_id_idx" ON "books" USING btree ("library_id","primary_author_sort_name" asc nulls last,"id") WHERE "books"."status" <> 'processing';--> statement-breakpoint
CREATE INDEX "books_library_author_sort_desc_id_idx" ON "books" USING btree ("library_id","primary_author_sort_name" desc nulls last,"id") WHERE "books"."status" <> 'processing';--> statement-breakpoint
CREATE INDEX "book_authors_book_display_author_idx" ON "book_authors" USING btree ("book_id","display_order","author_id");--> statement-breakpoint
CREATE INDEX "bm_title_book_id_idx" ON "book_metadata" USING btree ("title","book_id");--> statement-breakpoint
CREATE INDEX "bm_series_id_index_book_id_idx" ON "book_metadata" USING btree ("series_id","series_index","book_id");