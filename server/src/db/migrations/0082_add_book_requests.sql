CREATE TYPE "public"."book_request_media_kind" AS ENUM('ebook', 'audiobook', 'comic');--> statement-breakpoint
CREATE TABLE "book_dock_unit_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"dock_file_id" integer NOT NULL,
	"absolute_path" text NOT NULL,
	"file_name" varchar(500) NOT NULL,
	"file_size" bigint,
	"format" varchar(20),
	"role" varchar(20) DEFAULT 'content' NOT NULL,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_dock_unit_files_absolute_path_unique" UNIQUE("absolute_path"),
	CONSTRAINT "book_dock_unit_files_role_chk" CHECK ("book_dock_unit_files"."role" in ('content', 'cover', 'metadata', 'supplement'))
);
--> statement-breakpoint
CREATE TABLE "book_request_dedupe_aliases" (
	"request_id" integer NOT NULL,
	"dedupe_key" varchar(500) NOT NULL,
	CONSTRAINT "book_request_dedupe_aliases_request_id_dedupe_key_pk" PRIMARY KEY("request_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "book_request_dismissals" (
	"request_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_request_dismissals_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "book_request_subscribers" (
	"request_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_request_subscribers_request_id_user_id_pk" PRIMARY KEY("request_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "book_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"media_kind" "book_request_media_kind" NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"title" varchar(500) NOT NULL,
	"subtitle" varchar(500),
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"series_name" varchar(500),
	"series_index" integer,
	"isbn10" varchar(20),
	"isbn13" varchar(20),
	"published_year" integer,
	"language" varchar(20),
	"cover_url" text,
	"provider_key" varchar(50),
	"provider_id" varchar(255),
	"metadata_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"target_library_id" integer,
	"target_folder_id" integer,
	"created_by_user_id" integer,
	"decided_by_user_id" integer,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"matched_book_id" integer,
	"book_dock_file_id" integer,
	"status_reason" text,
	"failure_code" varchar(50),
	"failure_meta" jsonb,
	"self_serve" boolean DEFAULT false NOT NULL,
	"fulfiller_user_id" integer,
	"dedupe_key" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_requests_status_chk" CHECK ("book_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled', 'searching', 'grabbed', 'downloading', 'importing', 'needs_review', 'available', 'failed')),
	CONSTRAINT "book_requests_series_index_nonnegative_chk" CHECK ("book_requests"."series_index" is null or "book_requests"."series_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_request_downloads" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"download_client_id" integer,
	"indexer_id" integer,
	"source" varchar(20) NOT NULL,
	"automated" boolean DEFAULT false NOT NULL,
	"release_title" varchar(500) NOT NULL,
	"release_guid" varchar(500),
	"release_size_bytes" bigint,
	"release_seeders" integer,
	"release_format" varchar(20),
	"freeleech" boolean DEFAULT false NOT NULL,
	"client_hash" varchar(64),
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"downloaded_bytes" bigint DEFAULT 0 NOT NULL,
	"total_bytes" bigint,
	"content_path" text,
	"local_path" text,
	"book_dock_file_id" integer,
	"release_units" jsonb,
	"error_message" text,
	"grabbed_at" timestamp with time zone,
	"last_progress_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"imported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_request_downloads_source_chk" CHECK ("book_request_downloads"."source" in ('magnet', 'torrent_file', 'direct_url')),
	CONSTRAINT "book_request_downloads_status_chk" CHECK ("book_request_downloads"."status" in ('queued', 'downloading', 'completed', 'importing', 'needs_review', 'imported', 'failed')),
	CONSTRAINT "book_request_downloads_progress_range_chk" CHECK ("book_request_downloads"."progress_percent" >= 0 and "book_request_downloads"."progress_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE "download_client_path_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"download_client_id" integer NOT NULL,
	"remote_path" varchar(4096) NOT NULL,
	"local_path" varchar(4096) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "download_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(16),
	"adapter_type" varchar(30) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"base_url" text NOT NULL,
	"username" varchar(255),
	"credentials_enc" text,
	"category" varchar(100) DEFAULT 'bookorbit' NOT NULL,
	"use_hardlinks" boolean DEFAULT true NOT NULL,
	"allow_private_address" boolean DEFAULT true NOT NULL,
	"settings" jsonb,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "download_clients_adapter_type_chk" CHECK ("download_clients"."adapter_type" in ('qbittorrent', 'transmission', 'deluge')),
	CONSTRAINT "download_clients_priority_range_chk" CHECK ("download_clients"."priority" >= 1 and "download_clients"."priority" <= 100)
);
--> statement-breakpoint
CREATE TABLE "request_indexers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(16),
	"adapter_type" varchar(30) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_url" text NOT NULL,
	"credentials_enc" text,
	"allow_private_address" boolean DEFAULT false NOT NULL,
	"categories" jsonb,
	"disabled_media_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"isbn_search_disabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb,
	"network_profile" jsonb,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_error_message" text,
	"last_search_at" timestamp with time zone,
	"last_search_ok" boolean,
	"last_search_error" text,
	"search_failure_streak" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_indexers_adapter_type_chk" CHECK ("request_indexers"."adapter_type" ~ '^[a-z0-9][a-z0-9-]{0,29}$')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "see_own_requested_books" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD COLUMN "unit_directory" text;--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD COLUMN "auto_finalize_suppressed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book_dock_unit_files" ADD CONSTRAINT "book_dock_unit_files_dock_file_id_book_dock_files_id_fk" FOREIGN KEY ("dock_file_id") REFERENCES "public"."book_dock_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_dedupe_aliases" ADD CONSTRAINT "book_request_dedupe_aliases_request_id_book_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."book_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_dismissals" ADD CONSTRAINT "book_request_dismissals_request_id_book_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."book_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_dismissals" ADD CONSTRAINT "book_request_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_subscribers" ADD CONSTRAINT "book_request_subscribers_request_id_book_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."book_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_subscribers" ADD CONSTRAINT "book_request_subscribers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_target_library_id_libraries_id_fk" FOREIGN KEY ("target_library_id") REFERENCES "public"."libraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_target_folder_id_library_folders_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_matched_book_id_books_id_fk" FOREIGN KEY ("matched_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_book_dock_file_id_book_dock_files_id_fk" FOREIGN KEY ("book_dock_file_id") REFERENCES "public"."book_dock_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_requests" ADD CONSTRAINT "book_requests_fulfiller_user_id_users_id_fk" FOREIGN KEY ("fulfiller_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD CONSTRAINT "book_request_downloads_request_id_book_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."book_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD CONSTRAINT "book_request_downloads_download_client_id_download_clients_id_fk" FOREIGN KEY ("download_client_id") REFERENCES "public"."download_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD CONSTRAINT "book_request_downloads_indexer_id_request_indexers_id_fk" FOREIGN KEY ("indexer_id") REFERENCES "public"."request_indexers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD CONSTRAINT "book_request_downloads_book_dock_file_id_book_dock_files_id_fk" FOREIGN KEY ("book_dock_file_id") REFERENCES "public"."book_dock_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_client_path_mappings" ADD CONSTRAINT "download_client_path_mappings_download_client_id_download_clients_id_fk" FOREIGN KEY ("download_client_id") REFERENCES "public"."download_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_dock_unit_files_dock_file_id_sort_order_idx" ON "book_dock_unit_files" USING btree ("dock_file_id","sort_order");--> statement-breakpoint
CREATE INDEX "book_request_dedupe_aliases_key_idx" ON "book_request_dedupe_aliases" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "book_request_dismissals_user_id_idx" ON "book_request_dismissals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "book_request_subscribers_user_id_idx" ON "book_request_subscribers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "book_requests_user_status_idx" ON "book_requests" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "book_requests_status_created_at_idx" ON "book_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "book_requests_target_library_id_idx" ON "book_requests" USING btree ("target_library_id");--> statement-breakpoint
CREATE INDEX "book_requests_created_at_idx" ON "book_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "book_requests_title_idx" ON "book_requests" USING btree ("title");--> statement-breakpoint
CREATE INDEX "book_requests_matched_book_user_idx" ON "book_requests" USING btree ("matched_book_id","user_id") WHERE "book_requests"."matched_book_id" is not null;--> statement-breakpoint
CREATE INDEX "book_requests_self_serve_idx" ON "book_requests" USING btree ("self_serve","status","created_at") WHERE "book_requests"."self_serve";--> statement-breakpoint
CREATE UNIQUE INDEX "book_requests_active_dedupe_key_uidx" ON "book_requests" USING btree ("dedupe_key") WHERE "book_requests"."status" in ('pending', 'approved', 'searching', 'grabbed', 'downloading', 'importing', 'needs_review');--> statement-breakpoint
CREATE INDEX "book_request_downloads_status_idx" ON "book_request_downloads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "book_request_downloads_request_latest_idx" ON "book_request_downloads" USING btree ("request_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "book_request_downloads_book_dock_file_id_idx" ON "book_request_downloads" USING btree ("book_dock_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_request_downloads_active_hash_uidx" ON "book_request_downloads" USING btree (coalesce("download_client_id", 0),"client_hash") WHERE "book_request_downloads"."status" in ('queued', 'downloading', 'completed', 'importing', 'needs_review');--> statement-breakpoint
CREATE UNIQUE INDEX "download_client_path_mappings_client_remote_uidx" ON "download_client_path_mappings" USING btree ("download_client_id","remote_path");--> statement-breakpoint
CREATE UNIQUE INDEX "download_clients_name_lower_uidx" ON "download_clients" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "download_clients_enabled_priority_idx" ON "download_clients" USING btree ("enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "request_indexers_name_lower_uidx" ON "request_indexers" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "request_indexers_enabled_idx" ON "request_indexers" USING btree ("enabled");--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD CONSTRAINT "book_dock_files_unit_directory_unique" UNIQUE("unit_directory");