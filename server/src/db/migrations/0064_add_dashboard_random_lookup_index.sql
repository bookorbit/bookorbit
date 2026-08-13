DROP INDEX "books_library_status_idx";--> statement-breakpoint
CREATE INDEX "books_library_status_id_idx" ON "books" USING btree ("library_id","status","id");