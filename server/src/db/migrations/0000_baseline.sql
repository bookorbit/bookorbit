CREATE TYPE "public"."library_access_level" AS ENUM('viewer', 'editor', 'owner');--> statement-breakpoint
CREATE TYPE "public"."user_avatar_source" AS ENUM('none', 'external', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."opds_sort_order" AS ENUM('recent', 'title_asc', 'title_desc', 'author_asc', 'author_desc', 'series_asc', 'series_desc');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"actor_username" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"resource" varchar(100),
	"resource_id" integer,
	"description" text NOT NULL,
	"ip" varchar(45),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "magic_access_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_by" integer,
	"label" varchar(100) NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"raw_token" varchar(255) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "magic_access_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "magic_access_tokens_use_count_nonneg_chk" CHECK ("magic_access_tokens"."use_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_reset_tokens_expires_after_created_chk" CHECK ("password_reset_tokens"."expires_at" > "password_reset_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "refresh_tokens_expires_after_created_chk" CHECK ("refresh_tokens"."expires_at" > "refresh_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "user_library_access" (
	"user_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"access_level" "library_access_level" DEFAULT 'viewer' NOT NULL,
	CONSTRAINT "user_library_access_user_id_library_id_pk" PRIMARY KEY("user_id","library_id")
);
--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"user_id" integer NOT NULL,
	"permission_name" varchar(100) NOT NULL,
	CONSTRAINT "user_permissions_user_id_permission_name_pk" PRIMARY KEY("user_id","permission_name")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"password_hash" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"is_superuser" boolean DEFAULT false NOT NULL,
	"is_default_password" boolean DEFAULT false NOT NULL,
	"token_version" integer DEFAULT 1 NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"oidc_subject" text,
	"oidc_issuer" text,
	"avatar_url" text,
	"avatar_source" "user_avatar_source" DEFAULT 'none' NOT NULL,
	"avatar_version" integer DEFAULT 0 NOT NULL,
	"provisioning_method" varchar(20) DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_provisioning_method_chk" CHECK ("users"."provisioning_method" in ('local', 'manual', 'oidc', 'shared')),
	CONSTRAINT "users_token_version_nonnegative_chk" CHECK ("users"."token_version" >= 0),
	CONSTRAINT "users_failed_login_attempts_nonnegative_chk" CHECK ("users"."failed_login_attempts" >= 0),
	CONSTRAINT "users_avatar_version_nonnegative_chk" CHECK ("users"."avatar_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "comic_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"issue_number" text,
	"volume_name" text,
	"pencillers" text[],
	"inkers" text[],
	"colorists" text[],
	"letterers" text[],
	"cover_artists" text[],
	"characters" text[],
	"teams" text[],
	"locations" text[],
	"story_arcs" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comic_metadata_book_id_unique" UNIQUE("book_id")
);
--> statement-breakpoint
CREATE TABLE "migration_plan_artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"source_snapshot_hash" varchar(128) NOT NULL,
	"profile_hash" varchar(128) NOT NULL,
	"plan_hash" varchar(128) NOT NULL,
	"plan" jsonb NOT NULL,
	"source_data" jsonb,
	"summary" jsonb NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_plan_artifacts_id_source_profile_unique" UNIQUE("id","source_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "migration_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"user_mappings" jsonb NOT NULL,
	"path_mappings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_profiles_id_source_id_unique" UNIQUE("id","source_id"),
	CONSTRAINT "migration_profiles_version_positive_chk" CHECK ("migration_profiles"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "migration_run_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"stage" varchar(64) NOT NULL,
	"entity_type" varchar(64) NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"unresolved" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_run_metrics_processed_nonnegative_chk" CHECK ("migration_run_metrics"."processed" >= 0),
	CONSTRAINT "migration_run_metrics_imported_nonnegative_chk" CHECK ("migration_run_metrics"."imported" >= 0),
	CONSTRAINT "migration_run_metrics_skipped_nonnegative_chk" CHECK ("migration_run_metrics"."skipped" >= 0),
	CONSTRAINT "migration_run_metrics_unresolved_nonnegative_chk" CHECK ("migration_run_metrics"."unresolved" >= 0),
	CONSTRAINT "migration_run_metrics_failed_nonnegative_chk" CHECK ("migration_run_metrics"."failed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "migration_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"profile_id" integer NOT NULL,
	"plan_artifact_id" integer,
	"target_key" varchar(100) DEFAULT 'bookorbit' NOT NULL,
	"state" varchar(32) DEFAULT 'draft' NOT NULL,
	"current_stage" varchar(64),
	"triggered_by_user_id" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "migration_runs_state_chk" CHECK ("state" IN ('draft', 'preflight_failed', 'dry_run_ready', 'running', 'failed', 'completed')),
	CONSTRAINT "migration_runs_started_before_ended_chk" CHECK ("migration_runs"."ended_at" is null or "migration_runs"."started_at" is null or "migration_runs"."ended_at" >= "migration_runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "migration_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"connection_config" jsonb NOT NULL,
	"capabilities" jsonb,
	"last_validated_at" timestamp with time zone,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "libraries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"icon" varchar(100),
	"display_order" integer DEFAULT 0 NOT NULL,
	"cover_aspect_ratio" varchar(10) DEFAULT '2/3' NOT NULL,
	"watch" boolean DEFAULT false NOT NULL,
	"auto_scan_cron_expression" text,
	"metadata_precedence" jsonb DEFAULT '["folderStructure","embedded","nfoFile","opfFile","sidecar"]'::jsonb NOT NULL,
	"format_priority" jsonb DEFAULT '["epub","pdf","cbz","cbr","cb7","mobi","azw3","azw","fb2","m4b","mp3","m4a","opus","ogg","flac"]'::jsonb NOT NULL,
	"allowed_formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organization_mode" varchar(20) DEFAULT 'book_per_folder' NOT NULL,
	"exclude_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reading_threshold" double precision DEFAULT 0.25 NOT NULL,
	"mark_as_finished_percent_complete" integer DEFAULT 98 NOT NULL,
	"file_write_enabled" boolean DEFAULT false NOT NULL,
	"file_write_write_cover" boolean DEFAULT true NOT NULL,
	"file_write_epub_enabled" boolean DEFAULT true NOT NULL,
	"file_write_epub_max_file_size_mb" integer DEFAULT 100 NOT NULL,
	"file_write_pdf_enabled" boolean DEFAULT true NOT NULL,
	"file_write_pdf_max_file_size_mb" integer DEFAULT 100 NOT NULL,
	"file_write_cbx_enabled" boolean DEFAULT false NOT NULL,
	"file_write_cbx_max_file_size_mb" integer DEFAULT 500 NOT NULL,
	"file_naming_pattern" varchar(500),
	"metadata_fetch_preferences" jsonb,
	"book_metadata_fetch_config" jsonb,
	"book_metadata_fetch_last_run_at" timestamp with time zone,
	"book_metadata_fetch_last_queued_count" integer,
	"scan_mode" varchar(20) DEFAULT 'auto' NOT NULL,
	"poll_interval_seconds" integer DEFAULT 300,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "libraries_display_order_nonnegative_chk" CHECK ("libraries"."display_order" >= 0),
	CONSTRAINT "libraries_organization_mode_chk" CHECK ("libraries"."organization_mode" in ('book_per_folder', 'book_per_file')),
	CONSTRAINT "libraries_reading_threshold_range_chk" CHECK ("libraries"."reading_threshold" >= 0 and "libraries"."reading_threshold" <= 1),
	CONSTRAINT "libraries_mark_finished_percent_range_chk" CHECK ("libraries"."mark_as_finished_percent_complete" >= 0 and "libraries"."mark_as_finished_percent_complete" <= 100),
	CONSTRAINT "libraries_scan_mode_chk" CHECK ("libraries"."scan_mode" in ('auto', 'manual')),
	CONSTRAINT "libraries_poll_interval_nonnegative_chk" CHECK ("libraries"."poll_interval_seconds" is null or "libraries"."poll_interval_seconds" >= 0),
	CONSTRAINT "libraries_file_write_epub_max_size_chk" CHECK ("libraries"."file_write_epub_max_file_size_mb" >= 1),
	CONSTRAINT "libraries_file_write_pdf_max_size_chk" CHECK ("libraries"."file_write_pdf_max_file_size_mb" >= 1),
	CONSTRAINT "libraries_file_write_cbx_max_size_chk" CHECK ("libraries"."file_write_cbx_max_file_size_mb" >= 1)
);
--> statement-breakpoint
CREATE TABLE "library_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"path" varchar(4096) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_folders_id_library_id_unique" UNIQUE("id","library_id")
);
--> statement-breakpoint
CREATE TABLE "book_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"library_folder_id" integer NOT NULL,
	"absolute_path" varchar(4096) NOT NULL,
	"rel_path" varchar(4096),
	"ino" bigint NOT NULL,
	"size_bytes" bigint,
	"mtime" timestamp with time zone,
	"hash" varchar(64),
	"format" varchar(20),
	"role" varchar(20) DEFAULT 'content' NOT NULL,
	"sort_order" integer,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_files_role_chk" CHECK ("book_files"."role" in ('content', 'cover', 'metadata', 'supplement')),
	CONSTRAINT "book_files_size_bytes_nonnegative_chk" CHECK ("book_files"."size_bytes" is null or "book_files"."size_bytes" >= 0),
	CONSTRAINT "book_files_duration_seconds_nonnegative_chk" CHECK ("book_files"."duration_seconds" is null or "book_files"."duration_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"library_folder_id" integer NOT NULL,
	"primary_file_id" integer,
	"folder_path" varchar(4096) NOT NULL,
	"status" varchar(20) DEFAULT 'present' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_id_library_folder_id_unique" UNIQUE("id","library_folder_id"),
	CONSTRAINT "books_status_chk" CHECK ("books"."status" in ('present', 'missing'))
);
--> statement-breakpoint
CREATE TABLE "collection_books" (
	"collection_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_books_collection_id_book_id_pk" PRIMARY KEY("collection_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"description" text,
	"sync_to_kobo" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smart_scopes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"icon" varchar(64),
	"filter" jsonb,
	"default_sort" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "smart_scopes_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "author_enrichment_queue" (
	"author_id" integer PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"reason" varchar(50) DEFAULT 'unknown' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_http_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_enrichment_queue_status_chk" CHECK ("author_enrichment_queue"."status" in ('queued', 'processing', 'rate_limited', 'failed', 'done')),
	CONSTRAINT "author_enrichment_queue_reason_chk" CHECK ("author_enrichment_queue"."reason" in ('unknown', 'metadata_replace', 'manual_backfill', 'manual_backfill_all', 'author_rename', 'author_merge_target')),
	CONSTRAINT "author_enrichment_queue_attempt_count_nonnegative_chk" CHECK ("author_enrichment_queue"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"sort_name" varchar(500),
	"description" text,
	"has_photo" boolean DEFAULT false NOT NULL,
	"last_enriched_at" timestamp with time zone,
	CONSTRAINT "authors_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "book_authors" (
	"book_id" integer NOT NULL,
	"author_id" integer NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "book_authors_book_id_author_id_pk" PRIMARY KEY("book_id","author_id")
);
--> statement-breakpoint
CREATE TABLE "book_genres" (
	"book_id" integer NOT NULL,
	"genre_id" integer NOT NULL,
	CONSTRAINT "book_genres_book_id_genre_id_pk" PRIMARY KEY("book_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "book_metadata" (
	"book_id" integer PRIMARY KEY NOT NULL,
	"title" varchar(1000),
	"subtitle" varchar(1000),
	"description" text,
	"isbn10" varchar(10),
	"isbn13" varchar(13),
	"publisher" varchar(500),
	"published_year" integer,
	"language" varchar(100),
	"page_count" integer,
	"series_name" varchar(500),
	"series_index" real,
	"rating" integer,
	"cover_source" varchar(9),
	"google_books_id" varchar(50),
	"goodreads_id" varchar(50),
	"amazon_id" varchar(20),
	"hardcover_id" varchar(255),
	"open_library_id" varchar(50),
	"itunes_id" varchar(50),
	"metadata_score" integer,
	"last_metadata_fetch_at" timestamp with time zone,
	"embedding" vector(256),
	"last_written_at" timestamp with time zone,
	"duration_seconds" integer,
	"abridged" boolean DEFAULT false NOT NULL,
	"audible_id" varchar(20),
	"comicvine_id" varchar(50),
	"chapters" jsonb,
	"locked_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_metadata_rating_range_chk" CHECK ("book_metadata"."rating" is null or ("book_metadata"."rating" >= 1 and "book_metadata"."rating" <= 10)),
	CONSTRAINT "book_metadata_published_year_range_chk" CHECK ("book_metadata"."published_year" is null or ("book_metadata"."published_year" >= 1000 and "book_metadata"."published_year" <= 2200)),
	CONSTRAINT "book_metadata_page_count_nonnegative_chk" CHECK ("book_metadata"."page_count" is null or "book_metadata"."page_count" >= 0),
	CONSTRAINT "book_metadata_duration_seconds_nonnegative_chk" CHECK ("book_metadata"."duration_seconds" is null or "book_metadata"."duration_seconds" >= 0),
	CONSTRAINT "book_metadata_cover_source_chk" CHECK ("book_metadata"."cover_source" is null or "book_metadata"."cover_source" in ('extracted', 'custom'))
);
--> statement-breakpoint
CREATE TABLE "book_metadata_fetch_queue" (
	"book_id" integer PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"reason" varchar(50) DEFAULT 'manual_trigger' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"last_http_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_metadata_fetch_queue_status_chk" CHECK ("book_metadata_fetch_queue"."status" in ('queued', 'processing', 'failed')),
	CONSTRAINT "book_metadata_fetch_queue_reason_chk" CHECK ("book_metadata_fetch_queue"."reason" in ('event_import', 'manual_trigger', 'manual_retry')),
	CONSTRAINT "book_metadata_fetch_queue_attempt_count_nonnegative_chk" CHECK ("book_metadata_fetch_queue"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_tags" (
	"book_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "book_tags_book_id_tag_id_pk" PRIMARY KEY("book_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	CONSTRAINT "genres_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "book_narrators" (
	"book_id" integer NOT NULL,
	"narrator_id" integer NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "book_narrators_book_id_narrator_id_pk" PRIMARY KEY("book_id","narrator_id")
);
--> statement-breakpoint
CREATE TABLE "narrators" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"sort_name" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narrators_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "library_dir_scan_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_folder_id" integer NOT NULL,
	"dir_path" varchar(4096) NOT NULL,
	"last_seen_mtime_ms" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"triggered_by" varchar(20) NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "scan_jobs_status_chk" CHECK ("scan_jobs"."status" in ('running', 'completed', 'failed')),
	CONSTRAINT "scan_jobs_triggered_by_chk" CHECK ("scan_jobs"."triggered_by" in ('manual', 'watcher', 'schedule')),
	CONSTRAINT "scan_jobs_added_count_nonnegative_chk" CHECK ("scan_jobs"."added_count" >= 0),
	CONSTRAINT "scan_jobs_updated_count_nonnegative_chk" CHECK ("scan_jobs"."updated_count" >= 0),
	CONSTRAINT "scan_jobs_missing_count_nonnegative_chk" CHECK ("scan_jobs"."missing_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"cfi" varchar(2000) NOT NULL,
	"text" text NOT NULL,
	"color" varchar(20) DEFAULT 'yellow' NOT NULL,
	"style" varchar(20) DEFAULT 'highlight' NOT NULL,
	"note" text,
	"chapter_title" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotations_style_chk" CHECK ("annotations"."style" in ('highlight', 'underline', 'strikethrough', 'squiggly'))
);
--> statement-breakpoint
CREATE TABLE "audiobook_progress" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"percentage" real DEFAULT 0 NOT NULL,
	"current_file_id" integer NOT NULL,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audiobook_progress_user_id_book_id_pk" PRIMARY KEY("user_id","book_id"),
	CONSTRAINT "audiobook_progress_percentage_range_chk" CHECK ("audiobook_progress"."percentage" >= 0 and "audiobook_progress"."percentage" <= 100),
	CONSTRAINT "audiobook_progress_position_seconds_nonnegative_chk" CHECK ("audiobook_progress"."position_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"cfi" varchar(2000),
	"title" varchar(500) NOT NULL,
	"position_seconds" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_default_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"format_group" varchar(10) NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reader_default_preferences_format_group_chk" CHECK ("reader_default_preferences"."format_group" in ('epub', 'pdf', 'cbx', 'audio'))
);
--> statement-breakpoint
CREATE TABLE "reader_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"book_file_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"percentage" real DEFAULT 0 NOT NULL,
	"cfi" varchar(2000),
	"page_number" integer,
	"position_seconds" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_book_file_id_user_id_pk" PRIMARY KEY("book_file_id","user_id"),
	CONSTRAINT "reading_progress_percentage_range_chk" CHECK ("reading_progress"."percentage" >= 0 and "reading_progress"."percentage" <= 100),
	CONSTRAINT "reading_progress_page_number_nonnegative_chk" CHECK ("reading_progress"."page_number" is null or "reading_progress"."page_number" >= 0),
	CONSTRAINT "reading_progress_position_seconds_nonnegative_chk" CHECK ("reading_progress"."position_seconds" is null or "reading_progress"."position_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reading_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"progress_delta" real,
	"end_progress" real,
	CONSTRAINT "reading_sessions_duration_seconds_nonnegative_chk" CHECK ("reading_sessions"."duration_seconds" >= 0),
	CONSTRAINT "reading_sessions_end_progress_range_chk" CHECK ("reading_sessions"."end_progress" is null or ("reading_sessions"."end_progress" >= 0 and "reading_sessions"."end_progress" <= 100)),
	CONSTRAINT "reading_sessions_ended_after_started_chk" CHECK ("reading_sessions"."ended_at" >= "reading_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "user_book_ratings" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_book_ratings_user_id_book_id_pk" PRIMARY KEY("user_id","book_id"),
	CONSTRAINT "user_book_ratings_rating_range_chk" CHECK ("user_book_ratings"."rating" >= 1 and "user_book_ratings"."rating" <= 5)
);
--> statement-breakpoint
CREATE TABLE "user_book_status" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'unread' NOT NULL,
	"source" varchar(10) DEFAULT 'auto' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_book_status_user_id_book_id_pk" PRIMARY KEY("user_id","book_id"),
	CONSTRAINT "user_book_status_status_chk" CHECK ("user_book_status"."status" in ('unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned')),
	CONSTRAINT "user_book_status_source_chk" CHECK ("user_book_status"."source" in ('auto', 'manual')),
	CONSTRAINT "user_book_status_finished_after_started_chk" CHECK ("user_book_status"."finished_at" is null or "user_book_status"."started_at" is null or "user_book_status"."finished_at" >= "user_book_status"."started_at")
);
--> statement-breakpoint
CREATE TABLE "user_reading_daily_stats" (
	"user_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"day" date NOT NULL,
	"reading_seconds" integer DEFAULT 0 NOT NULL,
	"progress_delta" real DEFAULT 0 NOT NULL,
	"sessions_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_reading_daily_stats_user_id_library_id_day_pk" PRIMARY KEY("user_id","library_id","day"),
	CONSTRAINT "user_reading_daily_stats_reading_seconds_nonnegative_chk" CHECK ("user_reading_daily_stats"."reading_seconds" >= 0),
	CONSTRAINT "user_reading_daily_stats_sessions_count_nonnegative_chk" CHECK ("user_reading_daily_stats"."sessions_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "oidc_group_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"oidc_group_claim" text NOT NULL,
	"permission_name" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"oidc_subject" text NOT NULL,
	"oidc_issuer" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_permission_grants" (
	"user_id" integer NOT NULL,
	"provider_id" integer NOT NULL,
	"permission_name" varchar(100) NOT NULL,
	CONSTRAINT "oidc_permission_grants_user_id_provider_id_permission_name_pk" PRIMARY KEY("user_id","provider_id","permission_name")
);
--> statement-breakpoint
CREATE TABLE "oidc_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"issuer_uri" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"scopes" text DEFAULT 'openid profile email' NOT NULL,
	"icon_url" text,
	"claim_mapping" jsonb DEFAULT '{"username":"preferred_username","name":"name","email":"email","groups":"groups"}'::jsonb NOT NULL,
	"auto_provision" jsonb DEFAULT '{"enabled":false,"allowLocalLinking":false,"defaultPermissionNames":[]}'::jsonb NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_providers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "oidc_providers_issuer_uri_unique" UNIQUE("issuer_uri")
);
--> statement-breakpoint
CREATE TABLE "oidc_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider_id" integer,
	"oidc_subject" text NOT NULL,
	"oidc_issuer" text NOT NULL,
	"oidc_session_id" text,
	"id_token_hint" text,
	"idp_refresh_token" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oidc_states" (
	"state" text PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"meta" text
);
--> statement-breakpoint
CREATE TABLE "oidc_used_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opds_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"sort_order" "opds_sort_order" DEFAULT 'recent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opds_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "kobo_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"token" varchar(64) NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "kobo_library_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_library_snapshots_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "kobo_reading_states" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"entitlement_id" varchar(255) NOT NULL,
	"created_at_kobo" varchar(50),
	"last_modified_kobo" varchar(50),
	"priority_timestamp" varchar(50),
	"current_bookmark" jsonb,
	"statistics" jsonb,
	"status_info" jsonb,
	"progress_synced_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_reading_states_user_id_book_id_unique" UNIQUE("user_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "kobo_snapshot_books" (
	"snapshot_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"synced" boolean DEFAULT false NOT NULL,
	"pending_delete" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT true NOT NULL,
	"removed_by_device" boolean DEFAULT false NOT NULL,
	"file_hash" varchar(64),
	"metadata_hash" varchar(64),
	CONSTRAINT "kobo_snapshot_books_snapshot_id_book_id_pk" PRIMARY KEY("snapshot_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "kobo_sync_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"reading_threshold" real DEFAULT 1 NOT NULL,
	"finished_threshold" real DEFAULT 99 NOT NULL,
	"convert_to_kepub" boolean DEFAULT false NOT NULL,
	"two_way_progress_sync" boolean DEFAULT false NOT NULL,
	"force_enable_hyphenation" boolean DEFAULT false NOT NULL,
	"kepub_conversion_limit_mb" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_sync_settings_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "kobo_sync_settings_reading_threshold_range_chk" CHECK ("kobo_sync_settings"."reading_threshold" >= 0 and "kobo_sync_settings"."reading_threshold" <= 100),
	CONSTRAINT "kobo_sync_settings_finished_threshold_range_chk" CHECK ("kobo_sync_settings"."finished_threshold" >= 0 and "kobo_sync_settings"."finished_threshold" <= 100),
	CONSTRAINT "kobo_sync_settings_conversion_limit_nonnegative_chk" CHECK ("kobo_sync_settings"."kepub_conversion_limit_mb" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_dock_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" varchar(500) NOT NULL,
	"absolute_path" text NOT NULL,
	"file_size" bigint,
	"format" varchar(20),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"embedded_metadata" jsonb,
	"selected_metadata" jsonb,
	"fetched_metadata" jsonb,
	"cover_path" text,
	"target_library_id" integer,
	"target_folder_id" integer,
	"confidence" integer,
	"fetched_metadata_sources" jsonb,
	"error_message" text,
	"metadata_edited_at" timestamp with time zone,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_dock_files_absolute_path_unique" UNIQUE("absolute_path"),
	CONSTRAINT "book_dock_files_status_chk" CHECK ("book_dock_files"."status" in ('pending', 'extracting', 'fetching', 'ready', 'error')),
	CONSTRAINT "book_dock_files_confidence_range_chk" CHECK ("book_dock_files"."confidence" is null or ("book_dock_files"."confidence" >= 0 and "book_dock_files"."confidence" <= 100))
);
--> statement-breakpoint
CREATE TABLE "file_write_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"book_file_id" integer,
	"user_id" integer,
	"format" varchar(20) NOT NULL,
	"status" varchar(10) NOT NULL,
	"fields_written" jsonb,
	"error_message" text,
	"duration_ms" integer,
	"triggered_by" varchar(10) NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_write_log_status_chk" CHECK ("file_write_log"."status" in ('success', 'skipped', 'failed')),
	CONSTRAINT "file_write_log_triggered_by_chk" CHECK ("file_write_log"."triggered_by" in ('auto', 'sync')),
	CONSTRAINT "file_write_log_duration_ms_nonnegative_chk" CHECK ("file_write_log"."duration_ms" is null or "file_write_log"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(255) NOT NULL,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_templates_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "email_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(255) NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"username" varchar(255),
	"password_enc" text,
	"from_name" varchar(255),
	"from_address" varchar(255),
	"auth" boolean DEFAULT true NOT NULL,
	"ssl" boolean DEFAULT false NOT NULL,
	"start_tls" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"is_system_provider" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_providers_user_id_name_unique" UNIQUE("user_id","name"),
	CONSTRAINT "email_providers_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "email_providers_port_range_chk" CHECK ("email_providers"."port" >= 1 and "email_providers"."port" <= 65535)
);
--> statement-breakpoint
CREATE TABLE "email_recipient_group_members" (
	"user_id" integer NOT NULL,
	"group_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	CONSTRAINT "email_recipient_group_members_group_id_recipient_id_pk" PRIMARY KEY("group_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "email_recipient_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"default_template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_recipient_groups_user_id_name_unique" UNIQUE("user_id","name"),
	CONSTRAINT "email_recipient_groups_id_user_id_unique" UNIQUE("id","user_id")
);
--> statement-breakpoint
CREATE TABLE "email_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"device_type" varchar(20),
	"preferred_format" varchar(20),
	"default_template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_recipients_user_id_email_unique" UNIQUE("user_id","email"),
	CONSTRAINT "email_recipients_id_user_id_unique" UNIQUE("id","user_id"),
	CONSTRAINT "email_recipients_device_type_chk" CHECK ("email_recipients"."device_type" is null or "email_recipients"."device_type" in ('kindle', 'kobo', 'other')),
	CONSTRAINT "email_recipients_preferred_format_chk" CHECK ("email_recipients"."preferred_format" is null or "email_recipients"."preferred_format" in ('epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr'))
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"default_provider_id" integer,
	"default_recipient_id" integer,
	"default_template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "email_send_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer,
	"book_file_id" integer,
	"provider_id" integer,
	"template_id" integer,
	"to_email" varchar(255) NOT NULL,
	"to_name" varchar(255),
	"subject" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_send_log_status_chk" CHECK ("email_send_log"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "email_send_log_attempt_count_nonnegative_chk" CHECK ("email_send_log"."attempt_count" >= 0),
	CONSTRAINT "email_send_log_sent_after_created_chk" CHECK ("email_send_log"."sent_at" is null or "email_send_log"."sent_at" >= "email_send_log"."created_at")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text,
	"action_url" varchar(2048),
	"meta" jsonb,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dismissed_duplicate_pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id_a" integer NOT NULL,
	"entity_id_b" integer NOT NULL,
	"reason" text,
	"dismissed_by" integer NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dismissed_duplicate_pairs_unique" UNIQUE("entity_type","entity_id_a","entity_id_b")
);
--> statement-breakpoint
CREATE TABLE "dismissed_inline_duplicate_pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"value_a" varchar(500) NOT NULL,
	"value_b" varchar(500) NOT NULL,
	"reason" text,
	"dismissed_by" integer NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dismissed_inline_duplicate_pairs_unique" UNIQUE("entity_type","value_a","value_b")
);
--> statement-breakpoint
CREATE TABLE "user_fonts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"family_name" varchar(200) NOT NULL,
	"original_file_name" varchar(500) NOT NULL,
	"stored_file_name" varchar(500) NOT NULL,
	"format" varchar(10) NOT NULL,
	"weight" integer DEFAULT 400 NOT NULL,
	"style" varchar(10) DEFAULT 'normal' NOT NULL,
	"file_size" integer NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_fonts_format_chk" CHECK ("user_fonts"."format" in ('ttf', 'otf', 'woff', 'woff2')),
	CONSTRAINT "user_fonts_weight_chk" CHECK ("user_fonts"."weight" >= 100 and "user_fonts"."weight" <= 900 and "user_fonts"."weight" % 100 = 0),
	CONSTRAINT "user_fonts_style_chk" CHECK ("user_fonts"."style" in ('normal', 'italic'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_access_tokens" ADD CONSTRAINT "magic_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_access_tokens" ADD CONSTRAINT "magic_access_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_library_access" ADD CONSTRAINT "user_library_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_library_access" ADD CONSTRAINT "user_library_access_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comic_metadata" ADD CONSTRAINT "comic_metadata_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_plan_artifacts" ADD CONSTRAINT "migration_plan_artifacts_source_id_migration_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."migration_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_plan_artifacts" ADD CONSTRAINT "migration_plan_artifacts_profile_id_migration_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."migration_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_plan_artifacts" ADD CONSTRAINT "migration_plan_artifacts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_plan_artifacts" ADD CONSTRAINT "migration_plan_artifacts_profile_source_fk" FOREIGN KEY ("profile_id","source_id") REFERENCES "public"."migration_profiles"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_profiles" ADD CONSTRAINT "migration_profiles_source_id_migration_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."migration_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_profiles" ADD CONSTRAINT "migration_profiles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_run_metrics" ADD CONSTRAINT "migration_run_metrics_run_id_migration_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."migration_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_source_id_migration_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."migration_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_profile_id_migration_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."migration_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_plan_artifact_id_migration_plan_artifacts_id_fk" FOREIGN KEY ("plan_artifact_id") REFERENCES "public"."migration_plan_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_profile_source_fk" FOREIGN KEY ("profile_id","source_id") REFERENCES "public"."migration_profiles"("id","source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_runs" ADD CONSTRAINT "migration_runs_plan_artifact_source_profile_fk" FOREIGN KEY ("plan_artifact_id","source_id","profile_id") REFERENCES "public"."migration_plan_artifacts"("id","source_id","profile_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "migration_sources" ADD CONSTRAINT "migration_sources_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_library_folder_id_library_folders_id_fk" FOREIGN KEY ("library_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_book_folder_consistency_fk" FOREIGN KEY ("book_id","library_folder_id") REFERENCES "public"."books"("id","library_folder_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_library_folder_id_library_folders_id_fk" FOREIGN KEY ("library_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_primary_file_id_book_files_id_fk" FOREIGN KEY ("primary_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_library_folder_library_fk" FOREIGN KEY ("library_folder_id","library_id") REFERENCES "public"."library_folders"("id","library_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_books" ADD CONSTRAINT "collection_books_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_books" ADD CONSTRAINT "collection_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD CONSTRAINT "smart_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "author_enrichment_queue" ADD CONSTRAINT "author_enrichment_queue_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_genres" ADD CONSTRAINT "book_genres_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_genres" ADD CONSTRAINT "book_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD CONSTRAINT "book_metadata_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_metadata_fetch_queue" ADD CONSTRAINT "book_metadata_fetch_queue_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_tags" ADD CONSTRAINT "book_tags_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_tags" ADD CONSTRAINT "book_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_narrators" ADD CONSTRAINT "book_narrators_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_narrators" ADD CONSTRAINT "book_narrators_narrator_id_narrators_id_fk" FOREIGN KEY ("narrator_id") REFERENCES "public"."narrators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_dir_scan_state" ADD CONSTRAINT "library_dir_scan_state_library_folder_id_library_folders_id_fk" FOREIGN KEY ("library_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD CONSTRAINT "audiobook_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD CONSTRAINT "audiobook_progress_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_progress" ADD CONSTRAINT "audiobook_progress_current_file_id_book_files_id_fk" FOREIGN KEY ("current_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_default_preferences" ADD CONSTRAINT "reader_default_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_preferences" ADD CONSTRAINT "reader_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_preferences" ADD CONSTRAINT "reader_preferences_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_book_ratings" ADD CONSTRAINT "user_book_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_book_ratings" ADD CONSTRAINT "user_book_ratings_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_book_status" ADD CONSTRAINT "user_book_status_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_book_status" ADD CONSTRAINT "user_book_status_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reading_daily_stats" ADD CONSTRAINT "user_reading_daily_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reading_daily_stats" ADD CONSTRAINT "user_reading_daily_stats_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_group_mappings" ADD CONSTRAINT "oidc_group_mappings_provider_id_oidc_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oidc_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_identities" ADD CONSTRAINT "oidc_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_identities" ADD CONSTRAINT "oidc_identities_provider_id_oidc_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oidc_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_permission_grants" ADD CONSTRAINT "oidc_permission_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_permission_grants" ADD CONSTRAINT "oidc_permission_grants_provider_id_oidc_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oidc_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_sessions" ADD CONSTRAINT "oidc_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_sessions" ADD CONSTRAINT "oidc_sessions_provider_id_oidc_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oidc_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_states" ADD CONSTRAINT "oidc_states_provider_id_oidc_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."oidc_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opds_users" ADD CONSTRAINT "opds_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_devices" ADD CONSTRAINT "kobo_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_library_snapshots" ADD CONSTRAINT "kobo_library_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_reading_states" ADD CONSTRAINT "kobo_reading_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_reading_states" ADD CONSTRAINT "kobo_reading_states_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_snapshot_books" ADD CONSTRAINT "kobo_snapshot_books_snapshot_id_kobo_library_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."kobo_library_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_snapshot_books" ADD CONSTRAINT "kobo_snapshot_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_sync_settings" ADD CONSTRAINT "kobo_sync_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD CONSTRAINT "book_dock_files_target_library_id_libraries_id_fk" FOREIGN KEY ("target_library_id") REFERENCES "public"."libraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD CONSTRAINT "book_dock_files_target_folder_id_library_folders_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD CONSTRAINT "book_dock_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_write_log" ADD CONSTRAINT "file_write_log_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_write_log" ADD CONSTRAINT "file_write_log_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_write_log" ADD CONSTRAINT "file_write_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_providers" ADD CONSTRAINT "email_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_group_members" ADD CONSTRAINT "email_recipient_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_group_members" ADD CONSTRAINT "email_recipient_group_members_group_id_email_recipient_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."email_recipient_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_group_members" ADD CONSTRAINT "email_recipient_group_members_recipient_id_email_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."email_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_group_members" ADD CONSTRAINT "email_recipient_group_members_group_user_fk" FOREIGN KEY ("group_id","user_id") REFERENCES "public"."email_recipient_groups"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_group_members" ADD CONSTRAINT "email_recipient_group_members_recipient_user_fk" FOREIGN KEY ("recipient_id","user_id") REFERENCES "public"."email_recipients"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_groups" ADD CONSTRAINT "email_recipient_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_groups" ADD CONSTRAINT "email_recipient_groups_default_template_id_email_templates_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_default_template_id_email_templates_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_default_provider_id_email_providers_id_fk" FOREIGN KEY ("default_provider_id") REFERENCES "public"."email_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_default_recipient_id_email_recipients_id_fk" FOREIGN KEY ("default_recipient_id") REFERENCES "public"."email_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_default_template_id_email_templates_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_default_recipient_owner_fk" FOREIGN KEY ("default_recipient_id","user_id") REFERENCES "public"."email_recipients"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_provider_id_email_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."email_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_duplicate_pairs" ADD CONSTRAINT "dismissed_duplicate_pairs_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dismissed_inline_duplicate_pairs" ADD CONSTRAINT "dismissed_inline_duplicate_pairs_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fonts" ADD CONSTRAINT "user_fonts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_user_id" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_resource" ON "audit_log" USING btree ("resource","resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_ip" ON "audit_log" USING btree ("ip");--> statement-breakpoint
CREATE INDEX "idx_audit_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "magic_access_tokens_user_id_idx" ON "magic_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_library_access_library_user_idx" ON "user_library_access" USING btree ("library_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_uidx" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uidx" ON "users" USING btree (lower("email")) WHERE "users"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_oidc_subject_issuer_uidx" ON "users" USING btree ("oidc_subject","oidc_issuer") WHERE "users"."oidc_subject" is not null and "users"."oidc_issuer" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "migration_plan_artifacts_plan_hash_uidx" ON "migration_plan_artifacts" USING btree ("plan_hash");--> statement-breakpoint
CREATE INDEX "migration_plan_artifacts_source_id_idx" ON "migration_plan_artifacts" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "migration_plan_artifacts_profile_id_idx" ON "migration_plan_artifacts" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_profiles_source_name_version_uidx" ON "migration_profiles" USING btree ("source_id","name","version");--> statement-breakpoint
CREATE INDEX "migration_profiles_source_id_idx" ON "migration_profiles" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_run_metrics_run_stage_entity_uidx" ON "migration_run_metrics" USING btree ("run_id","stage","entity_type");--> statement-breakpoint
CREATE INDEX "migration_run_metrics_run_id_idx" ON "migration_run_metrics" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "migration_runs_source_target_state_idx" ON "migration_runs" USING btree ("source_id","target_key","state");--> statement-breakpoint
CREATE INDEX "migration_runs_state_idx" ON "migration_runs" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "migration_sources_type_name_uidx" ON "migration_sources" USING btree ("type","name");--> statement-breakpoint
CREATE INDEX "migration_sources_created_by_user_id_idx" ON "migration_sources" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "libraries_name_lower_uidx" ON "libraries" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "library_folders_library_id_idx" ON "library_folders" USING btree ("library_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_folders_library_path_uidx" ON "library_folders" USING btree ("library_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "book_files_absolute_path_uidx" ON "book_files" USING btree ("absolute_path");--> statement-breakpoint
CREATE INDEX "book_files_book_id_idx" ON "book_files" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "book_files_library_folder_id_idx" ON "book_files" USING btree ("library_folder_id");--> statement-breakpoint
CREATE INDEX "book_files_hash_idx" ON "book_files" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "book_files_ino_idx" ON "book_files" USING btree ("ino");--> statement-breakpoint
CREATE INDEX "book_files_format_idx" ON "book_files" USING btree ("format");--> statement-breakpoint
CREATE INDEX "book_files_library_folder_hash_idx" ON "book_files" USING btree ("library_folder_id","hash");--> statement-breakpoint
CREATE INDEX "book_files_library_folder_ino_idx" ON "book_files" USING btree ("library_folder_id","ino");--> statement-breakpoint
CREATE UNIQUE INDEX "books_library_id_folder_path_idx" ON "books" USING btree ("library_id","folder_path");--> statement-breakpoint
CREATE INDEX "books_primary_file_id_idx" ON "books" USING btree ("primary_file_id");--> statement-breakpoint
CREATE INDEX "books_library_status_idx" ON "books" USING btree ("library_id","status");--> statement-breakpoint
CREATE INDEX "books_library_added_at_idx" ON "books" USING btree ("library_id","added_at" desc);--> statement-breakpoint
CREATE INDEX "collection_books_book_id_idx" ON "collection_books" USING btree ("book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_name_uidx" ON "collections" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "collections_user_display_name_idx" ON "collections" USING btree ("user_id","display_order","name");--> statement-breakpoint
CREATE INDEX "author_enrichment_queue_status_next_attempt_idx" ON "author_enrichment_queue" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "author_enrichment_queue_next_attempt_idx" ON "author_enrichment_queue" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "author_enrichment_queue_single_processing_idx" ON "author_enrichment_queue" USING btree ("status") WHERE "author_enrichment_queue"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "authors_name_trgm_idx" ON "authors" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "book_authors_author_id_idx" ON "book_authors" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "book_genres_genre_id_idx" ON "book_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "bm_title_trgm_idx" ON "book_metadata" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_title_lower_idx" ON "book_metadata" USING btree (lower("title"));--> statement-breakpoint
CREATE INDEX "bm_series_trgm_idx" ON "book_metadata" USING gin ("series_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_publisher_trgm_idx" ON "book_metadata" USING gin ("publisher" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_language_idx" ON "book_metadata" USING btree ("language");--> statement-breakpoint
CREATE INDEX "bm_language_trgm_idx" ON "book_metadata" USING gin ("language" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_published_year_idx" ON "book_metadata" USING btree ("published_year");--> statement-breakpoint
CREATE INDEX "bm_series_name_index_idx" ON "book_metadata" USING btree ("series_name","series_index");--> statement-breakpoint
CREATE INDEX "bm_isbn10_idx" ON "book_metadata" USING btree ("isbn10");--> statement-breakpoint
CREATE INDEX "bm_isbn13_idx" ON "book_metadata" USING btree ("isbn13");--> statement-breakpoint
CREATE INDEX "bm_embedding_hnsw_cosine_idx" ON "book_metadata" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "bmfq_status_idx" ON "book_metadata_fetch_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bmfq_created_at_idx" ON "book_metadata_fetch_queue" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bmfq_status_created_book_idx" ON "book_metadata_fetch_queue" USING btree ("status","created_at","book_id");--> statement-breakpoint
CREATE INDEX "book_tags_tag_id_idx" ON "book_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "genres_name_trgm_idx" ON "genres" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tags_name_trgm_idx" ON "tags" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "book_narrators_narrator_id_idx" ON "book_narrators" USING btree ("narrator_id");--> statement-breakpoint
CREATE INDEX "narrators_name_trgm_idx" ON "narrators" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "library_dir_scan_state_folder_dir_uidx" ON "library_dir_scan_state" USING btree ("library_folder_id","dir_path");--> statement-breakpoint
CREATE INDEX "library_dir_scan_state_folder_idx" ON "library_dir_scan_state" USING btree ("library_folder_id");--> statement-breakpoint
CREATE INDEX "scan_jobs_library_status_idx" ON "scan_jobs" USING btree ("library_id","status");--> statement-breakpoint
CREATE INDEX "annotations_user_id_idx" ON "annotations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "annotations_user_book_idx" ON "annotations" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE INDEX "abp_user_id_idx" ON "audiobook_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user_book_idx" ON "bookmarks" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_book_cfi_uidx" ON "bookmarks" USING btree ("user_id","book_id","cfi") WHERE "bookmarks"."cfi" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_book_pos_uidx" ON "bookmarks" USING btree ("user_id","book_id","position_seconds") WHERE "bookmarks"."position_seconds" is not null and "bookmarks"."cfi" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "rdp_user_format_idx" ON "reader_default_preferences" USING btree ("user_id","format_group");--> statement-breakpoint
CREATE UNIQUE INDEX "rp_user_file_idx" ON "reader_preferences" USING btree ("user_id","book_file_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_id_idx" ON "reading_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_updated_at_idx" ON "reading_progress" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rs_user_session_id_uidx" ON "reading_sessions" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "rs_user_started_at_idx" ON "reading_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "rs_book_file_started_at_idx" ON "reading_sessions" USING btree ("book_file_id","started_at");--> statement-breakpoint
CREATE INDEX "rs_user_book_file_idx" ON "reading_sessions" USING btree ("user_id","book_file_id");--> statement-breakpoint
CREATE INDEX "ubr_user_id_idx" ON "user_book_ratings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ubr_book_id_idx" ON "user_book_ratings" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "ubs_user_id_idx" ON "user_book_status" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ubs_user_status_idx" ON "user_book_status" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "urds_user_day_idx" ON "user_reading_daily_stats" USING btree ("user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_group_mappings_provider_claim_uidx" ON "oidc_group_mappings" USING btree ("provider_id","oidc_group_claim");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identities_provider_subject_uidx" ON "oidc_identities" USING btree ("provider_id","oidc_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identities_user_provider_uidx" ON "oidc_identities" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identities_issuer_subject_uidx" ON "oidc_identities" USING btree ("oidc_issuer","oidc_subject");--> statement-breakpoint
CREATE INDEX "oidc_identities_user_id_idx" ON "oidc_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oidc_providers_enabled_order_idx" ON "oidc_providers" USING btree ("enabled","display_order");--> statement-breakpoint
CREATE INDEX "oidc_sessions_user_active_idx" ON "oidc_sessions" USING btree ("user_id") WHERE "oidc_sessions"."revoked" = false;--> statement-breakpoint
CREATE INDEX "oidc_sessions_subject_issuer_idx" ON "oidc_sessions" USING btree ("oidc_subject","oidc_issuer");--> statement-breakpoint
CREATE INDEX "oidc_sessions_sid_idx" ON "oidc_sessions" USING btree ("oidc_session_id");--> statement-breakpoint
CREATE INDEX "oidc_sessions_expires_at_idx" ON "oidc_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oidc_sessions_provider_id_idx" ON "oidc_sessions" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "oidc_states_expires_at_idx" ON "oidc_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oidc_used_jtis_expires_at_idx" ON "oidc_used_jtis" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opds_users_username_lower_uidx" ON "opds_users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "kobo_devices_user_id_idx" ON "kobo_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kobo_snapshot_books_snapshot_synced_book_idx" ON "kobo_snapshot_books" USING btree ("snapshot_id","synced","book_id");--> statement-breakpoint
CREATE INDEX "book_dock_files_status_idx" ON "book_dock_files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "book_dock_files_uploaded_by_idx" ON "book_dock_files" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "fwl_book_id_written_at_idx" ON "file_write_log" USING btree ("book_id","written_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_one_default_per_user_uidx" ON "email_templates" USING btree ("user_id") WHERE "email_templates"."is_default" = true and "email_templates"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_system_name_unique" ON "email_templates" USING btree ("name") WHERE "email_templates"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_providers_one_default_per_user_uidx" ON "email_providers" USING btree ("user_id") WHERE "email_providers"."is_default" = true and "email_providers"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_providers_one_system_provider_uidx" ON "email_providers" USING btree ("is_system_provider") WHERE "email_providers"."is_system_provider" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "email_recipients_user_email_lower_uidx" ON "email_recipients" USING btree ("user_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "email_recipients_one_default_per_user_uidx" ON "email_recipients" USING btree ("user_id") WHERE "email_recipients"."is_default" = true;--> statement-breakpoint
CREATE INDEX "email_send_log_user_created_at_idx" ON "email_send_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "email_send_log_created_at_idx" ON "email_send_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_send_log_status_next_retry_idx" ON "email_send_log" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dismissed_duplicate_pairs_entity_a_idx" ON "dismissed_duplicate_pairs" USING btree ("entity_type","entity_id_a");--> statement-breakpoint
CREATE INDEX "dismissed_duplicate_pairs_entity_b_idx" ON "dismissed_duplicate_pairs" USING btree ("entity_type","entity_id_b");--> statement-breakpoint
CREATE INDEX "dismissed_inline_pairs_entity_a_idx" ON "dismissed_inline_duplicate_pairs" USING btree ("entity_type","value_a");--> statement-breakpoint
CREATE INDEX "dismissed_inline_pairs_entity_b_idx" ON "dismissed_inline_duplicate_pairs" USING btree ("entity_type","value_b");--> statement-breakpoint
CREATE UNIQUE INDEX "uf_user_hash_uidx" ON "user_fonts" USING btree ("user_id","file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uf_user_family_weight_style_uidx" ON "user_fonts" USING btree ("user_id","family_name","weight","style");