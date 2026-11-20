CREATE INDEX "bm_amazon_id_idx" ON "book_metadata" USING btree ("amazon_id") WHERE "book_metadata"."amazon_id" is not null;--> statement-breakpoint
CREATE INDEX "bm_audible_id_idx" ON "book_metadata" USING btree ("audible_id") WHERE "book_metadata"."audible_id" is not null;--> statement-breakpoint
CREATE INDEX "bm_google_books_id_idx" ON "book_metadata" USING btree ("google_books_id") WHERE "book_metadata"."google_books_id" is not null;--> statement-breakpoint
CREATE INDEX "bm_goodreads_id_idx" ON "book_metadata" USING btree ("goodreads_id") WHERE "book_metadata"."goodreads_id" is not null;