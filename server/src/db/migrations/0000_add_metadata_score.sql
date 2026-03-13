CREATE TYPE "public"."library_access_level" AS ENUM('viewer', 'editor', 'owner');--> statement-breakpoint
CREATE TYPE "public"."opds_sort_order" AS ENUM('recent', 'title_asc', 'title_desc', 'author_asc', 'author_desc', 'series_asc', 'series_desc');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(100) NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
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
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"oidc_subject" text,
	"oidc_issuer" text,
	"avatar_url" text,
	"provisioning_method" varchar(20) DEFAULT 'local' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "libraries" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"icon" varchar(100),
	"display_order" integer DEFAULT 0 NOT NULL,
	"watch" boolean DEFAULT false NOT NULL,
	"auto_scan_cron_expression" text,
	"metadata_precedence" jsonb DEFAULT '["folderStructure","embedded","nfoFile","opfFile","sidecar"]'::jsonb NOT NULL,
	"format_priority" jsonb DEFAULT '["epub","pdf","cbz","cbr","mobi","azw3","fb2"]'::jsonb NOT NULL,
	"allowed_formats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organization_mode" varchar(20) DEFAULT 'auto' NOT NULL,
	"exclude_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mark_as_finished_seconds_remaining" integer,
	"mark_as_finished_percent_complete" integer,
	"file_naming_pattern" varchar(500),
	"metadata_fetch_preferences" jsonb,
	"scan_mode" varchar(20) DEFAULT 'auto' NOT NULL,
	"poll_interval_seconds" integer DEFAULT 300,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"path" varchar(4096) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"mtime" timestamp,
	"hash" varchar(64),
	"format" varchar(20),
	"role" varchar(20) DEFAULT 'primary' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"library_folder_id" integer NOT NULL,
	"folder_path" varchar(4096) NOT NULL,
	"status" varchar(20) DEFAULT 'present' NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_books" (
	"collection_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"icon" varchar(64),
	"filter" jsonb,
	"default_sort" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lenses_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "authors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"sort_name" varchar(500),
	"description" text
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
	"language" varchar(10),
	"page_count" integer,
	"series_name" varchar(500),
	"series_index" real,
	"rating" integer,
	"cover_source" varchar(9),
	"google_books_id" varchar(50),
	"goodreads_id" varchar(50),
	"amazon_id" varchar(20),
	"hardcover_id" varchar(50),
	"open_library_id" varchar(50),
	"itunes_id" varchar(50),
	"metadata_score" integer,
	"embedding" vector(256),
	"last_written_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "scan_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"triggered_by" varchar(20) NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"cfi" varchar(2000) NOT NULL,
	"title" varchar(500) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_default_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"format_group" varchar(10) NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"book_file_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"percentage" real DEFAULT 0 NOT NULL,
	"cfi" varchar(2000),
	"page_number" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_book_file_id_user_id_pk" PRIMARY KEY("book_file_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "oidc_group_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"oidc_group_claim" text NOT NULL,
	"permission_name" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_group_mappings_oidc_group_claim_unique" UNIQUE("oidc_group_claim")
);
--> statement-breakpoint
CREATE TABLE "oidc_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"oidc_subject" text NOT NULL,
	"oidc_issuer" text NOT NULL,
	"oidc_session_id" text,
	"id_token_hint" text,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opds_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"username" varchar(100) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"sort_order" "opds_sort_order" DEFAULT 'recent' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opds_users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "kobo_devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"token" varchar(64) NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "kobo_library_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
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
	"progress_synced_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
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
	"convert_to_kepub" boolean DEFAULT true NOT NULL,
	"two_way_progress_sync" boolean DEFAULT false NOT NULL,
	"force_enable_hyphenation" boolean DEFAULT false NOT NULL,
	"kepub_conversion_limit_mb" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_sync_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "staging_files" (
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
	"metadata_edited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staging_files_absolute_path_unique" UNIQUE("absolute_path")
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
	"written_at" timestamp DEFAULT now() NOT NULL
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_providers_user_id_name_unique" UNIQUE("user_id","name")
);
--> statement-breakpoint
CREATE TABLE "email_recipient_group_members" (
	"group_id" integer NOT NULL,
	"recipient_id" integer NOT NULL,
	CONSTRAINT "email_recipient_group_members_group_id_recipient_id_unique" UNIQUE("group_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "email_recipient_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"default_template_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_recipient_groups_user_id_name_unique" UNIQUE("user_id","name")
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "email_recipients_user_id_email_unique" UNIQUE("user_id","email")
);
--> statement-breakpoint
CREATE TABLE "email_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"default_provider_id" integer,
	"default_recipient_id" integer,
	"default_template_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
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
	"next_retry_at" timestamp,
	"error_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_library_access" ADD CONSTRAINT "user_library_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_library_access" ADD CONSTRAINT "user_library_access_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_library_folder_id_library_folders_id_fk" FOREIGN KEY ("library_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_library_folder_id_library_folders_id_fk" FOREIGN KEY ("library_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_books" ADD CONSTRAINT "collection_books_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_books" ADD CONSTRAINT "collection_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lenses" ADD CONSTRAINT "lenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_authors" ADD CONSTRAINT "book_authors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_genres" ADD CONSTRAINT "book_genres_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_genres" ADD CONSTRAINT "book_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD CONSTRAINT "book_metadata_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_tags" ADD CONSTRAINT "book_tags_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_tags" ADD CONSTRAINT "book_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_default_preferences" ADD CONSTRAINT "reader_default_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_preferences" ADD CONSTRAINT "reader_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reader_preferences" ADD CONSTRAINT "reader_preferences_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_sessions" ADD CONSTRAINT "oidc_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opds_users" ADD CONSTRAINT "opds_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_devices" ADD CONSTRAINT "kobo_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_library_snapshots" ADD CONSTRAINT "kobo_library_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_reading_states" ADD CONSTRAINT "kobo_reading_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_reading_states" ADD CONSTRAINT "kobo_reading_states_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_snapshot_books" ADD CONSTRAINT "kobo_snapshot_books_snapshot_id_kobo_library_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."kobo_library_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_snapshot_books" ADD CONSTRAINT "kobo_snapshot_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_sync_settings" ADD CONSTRAINT "kobo_sync_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_files" ADD CONSTRAINT "staging_files_target_library_id_libraries_id_fk" FOREIGN KEY ("target_library_id") REFERENCES "public"."libraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging_files" ADD CONSTRAINT "staging_files_target_folder_id_library_folders_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_write_log" ADD CONSTRAINT "file_write_log_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_write_log" ADD CONSTRAINT "file_write_log_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_write_log" ADD CONSTRAINT "file_write_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_providers" ADD CONSTRAINT "email_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_group_members" ADD CONSTRAINT "email_recipient_group_members_group_id_email_recipient_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."email_recipient_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_group_members" ADD CONSTRAINT "email_recipient_group_members_recipient_id_email_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."email_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_groups" ADD CONSTRAINT "email_recipient_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipient_groups" ADD CONSTRAINT "email_recipient_groups_default_template_id_email_templates_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_recipients" ADD CONSTRAINT "email_recipients_default_template_id_email_templates_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_default_provider_id_email_providers_id_fk" FOREIGN KEY ("default_provider_id") REFERENCES "public"."email_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_default_recipient_id_email_recipients_id_fk" FOREIGN KEY ("default_recipient_id") REFERENCES "public"."email_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_preferences" ADD CONSTRAINT "email_preferences_default_template_id_email_templates_id_fk" FOREIGN KEY ("default_template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_provider_id_email_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."email_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD CONSTRAINT "email_send_log_template_id_email_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."email_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "books_library_id_folder_path_idx" ON "books" USING btree ("library_id","folder_path");--> statement-breakpoint
CREATE INDEX "authors_name_trgm_idx" ON "authors" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "book_authors_author_id_idx" ON "book_authors" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "bm_title_trgm_idx" ON "book_metadata" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_series_trgm_idx" ON "book_metadata" USING gin ("series_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_publisher_trgm_idx" ON "book_metadata" USING gin ("publisher" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "bm_language_idx" ON "book_metadata" USING btree ("language");--> statement-breakpoint
CREATE INDEX "annotations_user_id_idx" ON "annotations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user_id_idx" ON "bookmarks" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rdp_user_format_idx" ON "reader_default_preferences" USING btree ("user_id","format_group");--> statement-breakpoint
CREATE UNIQUE INDEX "rp_user_file_idx" ON "reader_preferences" USING btree ("user_id","book_file_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_id_idx" ON "reading_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oidc_sessions_user_id_idx" ON "oidc_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oidc_sessions_subject_issuer_idx" ON "oidc_sessions" USING btree ("oidc_subject","oidc_issuer");--> statement-breakpoint
CREATE INDEX "oidc_sessions_sid_idx" ON "oidc_sessions" USING btree ("oidc_session_id");--> statement-breakpoint
CREATE INDEX "staging_files_status_idx" ON "staging_files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "fwl_book_id_idx" ON "file_write_log" USING btree ("book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_templates_system_name_unique" ON "email_templates" USING btree ("name") WHERE "email_templates"."user_id" is null;