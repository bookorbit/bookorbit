ALTER TABLE "book_request_downloads" ADD COLUMN "release_info_url" text;--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD COLUMN "hold_for_review" boolean DEFAULT false NOT NULL;