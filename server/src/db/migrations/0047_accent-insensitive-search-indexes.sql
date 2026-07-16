CREATE INDEX "book_series_name_unaccent_trgm_idx" ON "book_series" USING gin (public.bookorbit_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "authors_name_unaccent_trgm_idx" ON "authors" USING gin (public.bookorbit_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_title_unaccent_trgm_idx" ON "book_metadata" USING gin (public.bookorbit_unaccent("title") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_series_unaccent_trgm_idx" ON "book_metadata" USING gin (public.bookorbit_unaccent("series_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_publisher_unaccent_trgm_idx" ON "book_metadata" USING gin (public.bookorbit_unaccent("publisher") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_language_unaccent_trgm_idx" ON "book_metadata" USING gin (public.bookorbit_unaccent("language") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "genres_name_unaccent_trgm_idx" ON "genres" USING gin (public.bookorbit_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tags_name_unaccent_trgm_idx" ON "tags" USING gin (public.bookorbit_unaccent("name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "narrators_name_unaccent_trgm_idx" ON "narrators" USING gin (public.bookorbit_unaccent("name") gin_trgm_ops);