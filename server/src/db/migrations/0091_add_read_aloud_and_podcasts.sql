CREATE TABLE "collection_podcasts" (
	"collection_id" integer NOT NULL,
	"podcast_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_podcasts_collection_id_podcast_id_pk" PRIMARY KEY("collection_id","podcast_id")
);
--> statement-breakpoint
CREATE TABLE "user_book_read_aloud_sync_settings" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"mode" varchar(20) DEFAULT 'auto' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_book_read_aloud_sync_settings_user_id_book_id_pk" PRIMARY KEY("user_id","book_id"),
	CONSTRAINT "user_book_read_aloud_sync_settings_mode_chk" CHECK ("user_book_read_aloud_sync_settings"."mode" in ('auto', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "tts_book_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"provider_id" integer,
	"voice_id" varchar(200),
	"speed" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(30) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_url" varchar(500),
	"api_key" varchar(500),
	"default_model" varchar(100),
	"static_voices" jsonb,
	"supports_voice_discovery" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_reading_position" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"cfi" text NOT NULL,
	"chapter_index" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tts_user_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider_id" integer,
	"voice_id" varchar(200),
	"speed" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"idempotency_key" varchar(100) NOT NULL,
	"target_kind" varchar(30) NOT NULL,
	"target_library_id" integer,
	"target_folder_id" integer,
	"target_book_id" integer,
	"filename" varchar(500) NOT NULL,
	"content_type" varchar(200),
	"size_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"staging_path" text NOT NULL,
	"status" varchar(20) DEFAULT 'receiving' NOT NULL,
	"expected_sha256" varchar(64),
	"error_code" varchar(80),
	"error_message" text,
	"result_book_id" integer,
	"result_book_dock_file_id" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "upload_sessions_staging_path_unique" UNIQUE("staging_path"),
	CONSTRAINT "upload_sessions_target_kind_chk" CHECK ("upload_sessions"."target_kind" in ('library', 'existing_book', 'book_dock')),
	CONSTRAINT "upload_sessions_status_chk" CHECK ("upload_sessions"."status" in ('receiving', 'processing', 'completed', 'failed', 'cancelled', 'expired')),
	CONSTRAINT "upload_sessions_size_positive_chk" CHECK ("upload_sessions"."size_bytes" > 0),
	CONSTRAINT "upload_sessions_received_range_chk" CHECK ("upload_sessions"."received_bytes" >= 0 and "upload_sessions"."received_bytes" <= "upload_sessions"."size_bytes")
);
--> statement-breakpoint
CREATE TABLE "podcast_bookmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"position_seconds" real NOT NULL,
	"title" varchar(500) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_bookmarks_position_nonnegative_chk" CHECK ("podcast_bookmarks"."position_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "podcast_episode_media" (
	"episode_id" integer PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'remote' NOT NULL,
	"local_path" varchar(4096),
	"file_name" varchar(1000),
	"format" varchar(30),
	"mime_type" varchar(255),
	"size_bytes" bigint,
	"checksum" varchar(64),
	"last_error" varchar(2000),
	"downloaded_at" timestamp with time zone,
	"last_remote_validated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_episode_media_status_chk" CHECK ("podcast_episode_media"."status" in ('remote', 'queued', 'downloading', 'local', 'failed', 'unavailable')),
	CONSTRAINT "podcast_episode_media_size_nonnegative_chk" CHECK ("podcast_episode_media"."size_bytes" is null or "podcast_episode_media"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "podcast_episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"podcast_id" integer NOT NULL,
	"identity_hash" varchar(64) NOT NULL,
	"origin" varchar(10) DEFAULT 'feed' NOT NULL,
	"guid" text,
	"title" varchar(2000) NOT NULL,
	"subtitle" text,
	"description" text,
	"published_at" timestamp with time zone,
	"season" varchar(100),
	"episode" varchar(100),
	"episode_type" varchar(50),
	"duration_seconds" real,
	"explicit" boolean DEFAULT false NOT NULL,
	"enclosure_url_encrypted" text,
	"enclosure_url_hash" varchar(64),
	"enclosure_type" varchar(255),
	"enclosure_size_bytes" bigint,
	"chapters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transcripts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locked_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"in_feed" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unavailable_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_episodes_origin_chk" CHECK ("podcast_episodes"."origin" in ('feed', 'local')),
	CONSTRAINT "podcast_episodes_feed_origin_requires_enclosure_chk" CHECK ("podcast_episodes"."origin" = 'local' or "podcast_episodes"."enclosure_url_hash" is not null),
	CONSTRAINT "podcast_episodes_duration_nonnegative_chk" CHECK ("podcast_episodes"."duration_seconds" is null or "podcast_episodes"."duration_seconds" >= 0),
	CONSTRAINT "podcast_episodes_size_nonnegative_chk" CHECK ("podcast_episodes"."enclosure_size_bytes" is null or "podcast_episodes"."enclosure_size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "podcast_feed_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"podcast_id" integer NOT NULL,
	"url_hash" varchar(64) NOT NULL,
	"url_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "podcast_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(30) NOT NULL,
	"dedupe_key" varchar(255) NOT NULL,
	"library_id" integer NOT NULL,
	"podcast_id" integer,
	"episode_id" integer,
	"requested_by_user_id" integer,
	"download_batch_id" uuid,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress_current" bigint DEFAULT 0 NOT NULL,
	"progress_total" bigint,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"last_error" varchar(2000),
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_jobs_type_chk" CHECK ("podcast_jobs"."type" in ('refresh', 'reparse', 'download', 'retention', 'purge', 'opml_import', 'import_scan', 'local_import', 'merge', 'digest', 'file_cleanup')),
	CONSTRAINT "podcast_jobs_status_chk" CHECK ("podcast_jobs"."status" in ('queued', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "podcast_jobs_attempt_nonnegative_chk" CHECK ("podcast_jobs"."attempt_count" >= 0),
	CONSTRAINT "podcast_jobs_progress_nonnegative_chk" CHECK ("podcast_jobs"."progress_current" >= 0 and ("podcast_jobs"."progress_total" is null or "podcast_jobs"."progress_total" >= 0))
);
--> statement-breakpoint
CREATE TABLE "podcast_library_settings" (
	"library_id" integer PRIMARY KEY NOT NULL,
	"storage_quota_bytes" bigint DEFAULT 107374182400 NOT NULL,
	"minimum_free_space_bytes" bigint DEFAULT 5368709120 NOT NULL,
	"default_refresh_interval_minutes" integer DEFAULT 60 NOT NULL,
	"completion_remaining_seconds" integer DEFAULT 60 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_library_storage_quota_nonnegative_chk" CHECK ("podcast_library_settings"."storage_quota_bytes" >= 0),
	CONSTRAINT "podcast_library_free_space_nonnegative_chk" CHECK ("podcast_library_settings"."minimum_free_space_bytes" >= 0),
	CONSTRAINT "podcast_library_refresh_positive_chk" CHECK ("podcast_library_settings"."default_refresh_interval_minutes" > 0),
	CONSTRAINT "podcast_library_completion_nonnegative_chk" CHECK ("podcast_library_settings"."completion_remaining_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "podcast_listening_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"end_position_seconds" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcast_sessions_duration_nonnegative_chk" CHECK ("podcast_listening_sessions"."duration_seconds" >= 0),
	CONSTRAINT "podcast_sessions_position_nonnegative_chk" CHECK ("podcast_listening_sessions"."end_position_seconds" >= 0),
	CONSTRAINT "podcast_sessions_time_order_chk" CHECK ("podcast_listening_sessions"."ended_at" >= "podcast_listening_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "podcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"title" varchar(1000) NOT NULL,
	"author" varchar(1000),
	"description" text,
	"origin" varchar(10) DEFAULT 'feed' NOT NULL,
	"feed_url_encrypted" text,
	"feed_url_hash" varchar(64),
	"local_folder_path" varchar(4096),
	"image_url_encrypted" text,
	"site_url" text,
	"language" varchar(100),
	"podcast_type" varchar(50),
	"explicit" boolean DEFAULT false NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acquisition_policy" varchar(20) DEFAULT 'remote_only' NOT NULL,
	"auto_download_limit" integer,
	"auto_download_window_days" integer,
	"download_cleanup" varchar(20) DEFAULT 'keep' NOT NULL,
	"download_cleanup_delay_hours" integer DEFAULT 24 NOT NULL,
	"refresh_interval_minutes" integer DEFAULT 60 NOT NULL,
	"next_refresh_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_refresh_at" timestamp with time zone,
	"last_refresh_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(2000),
	"last_http_status" integer,
	"etag" varchar(1000),
	"last_modified" varchar(1000),
	"locked_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_artwork_at" timestamp with time zone,
	"feed_snapshot_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"missing_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "podcasts_origin_chk" CHECK ("podcasts"."origin" in ('feed', 'local')),
	CONSTRAINT "podcasts_feed_origin_requires_feed_chk" CHECK ("podcasts"."origin" = 'local' or "podcasts"."feed_url_hash" is not null),
	CONSTRAINT "podcasts_acquisition_policy_chk" CHECK ("podcasts"."acquisition_policy" in ('remote_only', 'manual', 'newest', 'window')),
	CONSTRAINT "podcasts_download_cleanup_chk" CHECK ("podcasts"."download_cleanup" in ('keep', 'after_finished')),
	CONSTRAINT "podcasts_download_cleanup_delay_chk" CHECK ("podcasts"."download_cleanup_delay_hours" >= 0),
	CONSTRAINT "podcasts_refresh_interval_positive_chk" CHECK ("podcasts"."refresh_interval_minutes" > 0),
	CONSTRAINT "podcasts_failures_nonnegative_chk" CHECK ("podcasts"."consecutive_failures" >= 0),
	CONSTRAINT "podcasts_auto_download_limit_chk" CHECK ("podcasts"."auto_download_limit" is null or "podcasts"."auto_download_limit" > 0),
	CONSTRAINT "podcasts_auto_download_window_chk" CHECK ("podcasts"."auto_download_window_days" is null or "podcasts"."auto_download_window_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_podcast_episode_state" (
	"user_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"progress_percent" real DEFAULT 0 NOT NULL,
	"finished" boolean DEFAULT false NOT NULL,
	"finished_at" timestamp with time zone,
	"pinned" boolean DEFAULT false NOT NULL,
	"last_listened_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_podcast_episode_state_user_id_episode_id_pk" PRIMARY KEY("user_id","episode_id"),
	CONSTRAINT "user_podcast_episode_state_position_chk" CHECK ("user_podcast_episode_state"."position_seconds" >= 0),
	CONSTRAINT "user_podcast_episode_state_progress_chk" CHECK ("user_podcast_episode_state"."progress_percent" >= 0 and "user_podcast_episode_state"."progress_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE "user_podcast_follows" (
	"user_id" integer NOT NULL,
	"podcast_id" integer NOT NULL,
	"notification_mode" varchar(20) DEFAULT 'off' NOT NULL,
	"last_notified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_podcast_follows_user_id_podcast_id_pk" PRIMARY KEY("user_id","podcast_id"),
	CONSTRAINT "user_podcast_follows_notification_chk" CHECK ("user_podcast_follows"."notification_mode" in ('off', 'immediate', 'daily', 'weekly'))
);
--> statement-breakpoint
CREATE TABLE "user_podcast_queue" (
	"user_id" integer NOT NULL,
	"episode_id" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_podcast_queue_user_id_episode_id_pk" PRIMARY KEY("user_id","episode_id"),
	CONSTRAINT "user_podcast_queue_position_nonnegative_chk" CHECK ("user_podcast_queue"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_user_id_name_unique";--> statement-breakpoint
ALTER TABLE "reading_sessions" DROP CONSTRAINT "reading_sessions_source_chk";--> statement-breakpoint
DROP INDEX "collections_user_name_uidx";--> statement-breakpoint
ALTER TABLE "libraries" ADD COLUMN "type" varchar(20) DEFAULT 'books' NOT NULL;--> statement-breakpoint
ALTER TABLE "libraries" ADD COLUMN "watch_local_folders" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "library_folders" ADD COLUMN "role" varchar(20) DEFAULT 'downloads' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_files" ADD COLUMN "media_overlay_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book_files" ADD COLUMN "media_overlay_duration_seconds" double precision;--> statement-breakpoint
ALTER TABLE "book_files" ADD COLUMN "media_overlay_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "media_type" varchar(20) DEFAULT 'books' NOT NULL;--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD COLUMN "media_type" varchar(20) DEFAULT 'books' NOT NULL;--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD COLUMN "library_id" integer;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "media_overlay_fragment" varchar(4096);--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "media_overlay_section_index" integer;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "session_type" varchar(20) DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD COLUMN "celebration_claim_id" uuid;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD COLUMN "celebration_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD COLUMN "celebrated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collection_podcasts" ADD CONSTRAINT "collection_podcasts_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_podcasts" ADD CONSTRAINT "collection_podcasts_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_book_read_aloud_sync_settings" ADD CONSTRAINT "user_book_read_aloud_sync_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_book_read_aloud_sync_settings" ADD CONSTRAINT "user_book_read_aloud_sync_settings_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_book_preferences" ADD CONSTRAINT "tts_book_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_book_preferences" ADD CONSTRAINT "tts_book_preferences_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_book_preferences" ADD CONSTRAINT "tts_book_preferences_provider_id_tts_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tts_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_reading_position" ADD CONSTRAINT "tts_reading_position_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_reading_position" ADD CONSTRAINT "tts_reading_position_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_user_preferences" ADD CONSTRAINT "tts_user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tts_user_preferences" ADD CONSTRAINT "tts_user_preferences_provider_id_tts_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."tts_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_target_library_id_libraries_id_fk" FOREIGN KEY ("target_library_id") REFERENCES "public"."libraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_target_folder_id_library_folders_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_target_book_id_books_id_fk" FOREIGN KEY ("target_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_result_book_id_books_id_fk" FOREIGN KEY ("result_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_bookmarks" ADD CONSTRAINT "podcast_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_bookmarks" ADD CONSTRAINT "podcast_bookmarks_episode_id_podcast_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episode_media" ADD CONSTRAINT "podcast_episode_media_episode_id_podcast_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_episodes" ADD CONSTRAINT "podcast_episodes_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_feed_aliases" ADD CONSTRAINT "podcast_feed_aliases_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_jobs" ADD CONSTRAINT "podcast_jobs_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_jobs" ADD CONSTRAINT "podcast_jobs_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_jobs" ADD CONSTRAINT "podcast_jobs_episode_id_podcast_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_jobs" ADD CONSTRAINT "podcast_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_library_settings" ADD CONSTRAINT "podcast_library_settings_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_listening_sessions" ADD CONSTRAINT "podcast_listening_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_listening_sessions" ADD CONSTRAINT "podcast_listening_sessions_episode_id_podcast_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcasts" ADD CONSTRAINT "podcasts_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_podcast_episode_state" ADD CONSTRAINT "user_podcast_episode_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_podcast_episode_state" ADD CONSTRAINT "user_podcast_episode_state_episode_id_podcast_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_podcast_follows" ADD CONSTRAINT "user_podcast_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_podcast_follows" ADD CONSTRAINT "user_podcast_follows_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_podcast_queue" ADD CONSTRAINT "user_podcast_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_podcast_queue" ADD CONSTRAINT "user_podcast_queue_episode_id_podcast_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."podcast_episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_podcasts_podcast_id_idx" ON "collection_podcasts" USING btree ("podcast_id");--> statement-breakpoint
CREATE INDEX "ubrass_user_id_idx" ON "user_book_read_aloud_sync_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tts_book_prefs_user_book_uidx" ON "tts_book_preferences" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tts_reading_pos_user_file_uidx" ON "tts_reading_position" USING btree ("user_id","book_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tts_user_prefs_user_uidx" ON "tts_user_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_user_idempotency_uidx" ON "upload_sessions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "upload_sessions_user_created_idx" ON "upload_sessions" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "upload_sessions_status_expires_idx" ON "upload_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "podcast_bookmarks_user_episode_idx" ON "podcast_bookmarks" USING btree ("user_id","episode_id");--> statement-breakpoint
CREATE INDEX "podcast_bookmarks_user_episode_position_idx" ON "podcast_bookmarks" USING btree ("user_id","episode_id","position_seconds");--> statement-breakpoint
CREATE INDEX "podcast_episode_media_status_idx" ON "podcast_episode_media" USING btree ("status");--> statement-breakpoint
CREATE INDEX "podcast_episode_media_downloaded_idx" ON "podcast_episode_media" USING btree ("downloaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "podcast_episodes_podcast_identity_uidx" ON "podcast_episodes" USING btree ("podcast_id","identity_hash");--> statement-breakpoint
CREATE INDEX "podcast_episodes_podcast_id_idx" ON "podcast_episodes" USING btree ("podcast_id","id");--> statement-breakpoint
CREATE INDEX "podcast_episodes_podcast_created_idx" ON "podcast_episodes" USING btree ("podcast_id","created_at");--> statement-breakpoint
CREATE INDEX "podcast_episodes_podcast_published_id_idx" ON "podcast_episodes" USING btree ("podcast_id","published_at" desc nulls last,"id" desc);--> statement-breakpoint
CREATE INDEX "podcast_episodes_title_trgm_idx" ON "podcast_episodes" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "podcast_episodes_duration_idx" ON "podcast_episodes" USING btree ("duration_seconds");--> statement-breakpoint
CREATE INDEX "podcast_episodes_enclosure_hash_idx" ON "podcast_episodes" USING btree ("enclosure_url_hash");--> statement-breakpoint
CREATE INDEX "podcast_episodes_in_feed_idx" ON "podcast_episodes" USING btree ("podcast_id","in_feed");--> statement-breakpoint
CREATE UNIQUE INDEX "podcast_feed_aliases_podcast_hash_uidx" ON "podcast_feed_aliases" USING btree ("podcast_id","url_hash");--> statement-breakpoint
CREATE INDEX "podcast_feed_aliases_hash_idx" ON "podcast_feed_aliases" USING btree ("url_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "podcast_jobs_active_dedupe_uidx" ON "podcast_jobs" USING btree ("dedupe_key") WHERE "podcast_jobs"."status" in ('queued', 'processing');--> statement-breakpoint
CREATE INDEX "podcast_jobs_due_idx" ON "podcast_jobs" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "podcast_jobs_library_status_idx" ON "podcast_jobs" USING btree ("library_id","status");--> statement-breakpoint
CREATE INDEX "podcast_jobs_status_updated_idx" ON "podcast_jobs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "podcast_jobs_download_batch_idx" ON "podcast_jobs" USING btree ("requested_by_user_id","download_batch_id","status") WHERE "podcast_jobs"."type" = 'download' and "podcast_jobs"."download_batch_id" is not null;--> statement-breakpoint
CREATE INDEX "podcast_jobs_active_podcast_type_idx" ON "podcast_jobs" USING btree ("podcast_id","type","requested_by_user_id") WHERE "podcast_jobs"."status" in ('queued', 'processing') and "podcast_jobs"."podcast_id" is not null;--> statement-breakpoint
CREATE INDEX "podcast_jobs_active_episode_type_idx" ON "podcast_jobs" USING btree ("episode_id","type") WHERE "podcast_jobs"."status" in ('queued', 'processing') and "podcast_jobs"."episode_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "podcast_sessions_user_session_uidx" ON "podcast_listening_sessions" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "podcast_sessions_user_started_idx" ON "podcast_listening_sessions" USING btree ("user_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "podcast_sessions_episode_started_idx" ON "podcast_listening_sessions" USING btree ("episode_id","started_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "podcasts_library_feed_hash_uidx" ON "podcasts" USING btree ("library_id","feed_url_hash") WHERE "podcasts"."feed_url_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "podcasts_library_local_folder_uidx" ON "podcasts" USING btree ("library_id","local_folder_path") WHERE "podcasts"."local_folder_path" is not null;--> statement-breakpoint
CREATE INDEX "podcasts_library_archived_title_idx" ON "podcasts" USING btree ("library_id","archived_at","title");--> statement-breakpoint
CREATE INDEX "podcasts_title_trgm_idx" ON "podcasts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "podcasts_author_trgm_idx" ON "podcasts" USING gin ("author" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "podcasts_due_refresh_idx" ON "podcasts" USING btree ("next_refresh_at") WHERE "podcasts"."archived_at" is null and "podcasts"."origin" = 'feed';--> statement-breakpoint
CREATE INDEX "podcasts_library_cleanup_idx" ON "podcasts" USING btree ("library_id") WHERE "podcasts"."download_cleanup" <> 'keep';--> statement-breakpoint
CREATE INDEX "user_podcast_episode_state_user_finished_idx" ON "user_podcast_episode_state" USING btree ("user_id","finished","updated_at" desc);--> statement-breakpoint
CREATE INDEX "user_podcast_episode_state_episode_active_idx" ON "user_podcast_episode_state" USING btree ("episode_id","finished","position_seconds");--> statement-breakpoint
CREATE INDEX "user_podcast_follows_podcast_idx" ON "user_podcast_follows" USING btree ("podcast_id","user_id");--> statement-breakpoint
CREATE INDEX "user_podcast_follows_due_digest_idx" ON "user_podcast_follows" USING btree ("notification_mode","last_notified_at","user_id","podcast_id") WHERE "user_podcast_follows"."notification_mode" in ('daily', 'weekly');--> statement-breakpoint
CREATE UNIQUE INDEX "user_podcast_queue_user_position_uidx" ON "user_podcast_queue" USING btree ("user_id","position");--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD CONSTRAINT "smart_scopes_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_files_media_overlay_available_idx" ON "book_files" USING btree ("media_overlay_available") WHERE "book_files"."media_overlay_available" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_media_type_name_uidx" ON "collections" USING btree ("user_id","media_type","name");--> statement-breakpoint
CREATE INDEX "smart_scopes_user_media_type_idx" ON "smart_scopes" USING btree ("user_id","media_type");--> statement-breakpoint
CREATE INDEX "user_achievements_pending_celebration_idx" ON "user_achievements" USING btree ("user_id","celebrated_at","awarded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_achievements_celebration_claim_uidx" ON "user_achievements" USING btree ("celebration_claim_id");--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD CONSTRAINT "smart_scopes_user_id_media_type_name_unique" UNIQUE("user_id","media_type","name");--> statement-breakpoint
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_type_chk" CHECK ("libraries"."type" in ('books', 'podcasts'));--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_role_chk" CHECK ("library_folders"."role" in ('downloads', 'local'));--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_media_overlay_duration_seconds_nonnegative_chk" CHECK ("book_files"."media_overlay_duration_seconds" is null or "book_files"."media_overlay_duration_seconds" >= 0);--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_media_type_chk" CHECK ("collections"."media_type" in ('books', 'podcasts'));--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_kobo_books_only_chk" CHECK ("collections"."sync_to_kobo" = false or "collections"."media_type" = 'books');--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD CONSTRAINT "smart_scopes_media_type_chk" CHECK ("smart_scopes"."media_type" in ('books', 'podcasts'));--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD CONSTRAINT "smart_scopes_library_scope_chk" CHECK (("smart_scopes"."media_type" = 'podcasts') = ("smart_scopes"."library_id" is not null));--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD CONSTRAINT "smart_scopes_kobo_books_only_chk" CHECK ("smart_scopes"."sync_to_kobo" = false or "smart_scopes"."media_type" = 'books');--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_media_overlay_section_index_nonnegative_chk" CHECK ("reading_progress"."media_overlay_section_index" is null or "reading_progress"."media_overlay_section_index" >= 0);--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_source_chk" CHECK ("reading_sessions"."source" in ('web', 'ios', 'watchos', 'koreader', 'manual', 'kobo'));