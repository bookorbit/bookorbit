CREATE TABLE "book_request_upload_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"download_id" integer NOT NULL,
	"path" varchar(1024) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_request_upload_files_status_chk" CHECK ("book_request_upload_files"."status" in ('pending', 'received')),
	CONSTRAINT "book_request_upload_files_size_positive_chk" CHECK ("book_request_upload_files"."size_bytes" > 0),
	CONSTRAINT "book_request_upload_files_received_range_chk" CHECK ("book_request_upload_files"."received_bytes" >= 0 and "book_request_upload_files"."received_bytes" <= "book_request_upload_files"."size_bytes")
);
--> statement-breakpoint
ALTER TABLE "book_request_downloads" DROP CONSTRAINT "book_request_downloads_source_chk";--> statement-breakpoint
ALTER TABLE "upload_sessions" DROP CONSTRAINT "upload_sessions_target_kind_chk";--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD COLUMN "uploaded_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "target_request_file_id" integer;--> statement-breakpoint
ALTER TABLE "book_request_upload_files" ADD CONSTRAINT "book_request_upload_files_download_id_book_request_downloads_id_fk" FOREIGN KEY ("download_id") REFERENCES "public"."book_request_downloads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_request_upload_files_download_path_uidx" ON "book_request_upload_files" USING btree ("download_id","path");--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD CONSTRAINT "book_request_downloads_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_target_request_file_id_book_request_upload_files_id_fk" FOREIGN KEY ("target_request_file_id") REFERENCES "public"."book_request_upload_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_sessions_target_request_file_idx" ON "upload_sessions" USING btree ("target_request_file_id");--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD CONSTRAINT "book_request_downloads_source_chk" CHECK ("book_request_downloads"."source" in ('magnet', 'torrent_file', 'direct_url', 'nzb_file', 'upload'));--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_target_kind_chk" CHECK ("upload_sessions"."target_kind" in ('library', 'existing_book', 'book_dock', 'book_request'));