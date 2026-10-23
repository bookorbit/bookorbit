ALTER TABLE "book_requests" ADD COLUMN "companion_request_id" integer;--> statement-breakpoint
ALTER TABLE "book_requests" ADD COLUMN "target_book_id" integer;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_companion_request_id_book_requests_id_fk" FOREIGN KEY ("companion_request_id") REFERENCES "public"."book_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_target_book_id_books_id_fk" FOREIGN KEY ("target_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_requests_companion_request_id_idx" ON "book_requests" USING btree ("companion_request_id") WHERE "book_requests"."companion_request_id" is not null;--> statement-breakpoint
CREATE INDEX "book_requests_target_book_id_idx" ON "book_requests" USING btree ("target_book_id") WHERE "book_requests"."target_book_id" is not null;