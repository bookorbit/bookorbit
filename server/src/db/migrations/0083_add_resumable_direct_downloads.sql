ALTER TABLE "book_request_downloads" ADD COLUMN "direct_url" text;--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD COLUMN "direct_file_name" varchar(500);--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD COLUMN "direct_etag" varchar(1024);--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD COLUMN "direct_last_modified" varchar(200);