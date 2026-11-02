ALTER TABLE "collection_podcasts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_bookmarks" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_episode_media" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_episodes" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_feed_aliases" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_jobs" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_library_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcast_listening_sessions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "podcasts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_podcast_episode_state" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_podcast_follows" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_podcast_queue" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "collection_podcasts" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_bookmarks" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_episode_media" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_episodes" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_feed_aliases" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_jobs" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_library_settings" CASCADE;--> statement-breakpoint
DROP TABLE "podcast_listening_sessions" CASCADE;--> statement-breakpoint
DROP TABLE "podcasts" CASCADE;--> statement-breakpoint
DROP TABLE "user_podcast_episode_state" CASCADE;--> statement-breakpoint
DROP TABLE "user_podcast_follows" CASCADE;--> statement-breakpoint
DROP TABLE "user_podcast_queue" CASCADE;--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_user_id_media_type_name_unique";--> statement-breakpoint
ALTER TABLE "libraries" DROP CONSTRAINT "libraries_type_chk";--> statement-breakpoint
ALTER TABLE "library_folders" DROP CONSTRAINT "library_folders_role_chk";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_media_type_chk";--> statement-breakpoint
ALTER TABLE "collections" DROP CONSTRAINT "collections_kobo_books_only_chk";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_media_type_chk";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_library_scope_chk";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_kobo_books_only_chk";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP CONSTRAINT "smart_scopes_library_id_libraries_id_fk";
--> statement-breakpoint
DROP INDEX "collections_user_media_type_name_uidx";--> statement-breakpoint
DROP INDEX "smart_scopes_user_media_type_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_name_uidx" ON "collections" USING btree ("user_id","name");--> statement-breakpoint
ALTER TABLE "libraries" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "libraries" DROP COLUMN "watch_local_folders";--> statement-breakpoint
ALTER TABLE "library_folders" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "collections" DROP COLUMN "media_type";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP COLUMN "media_type";--> statement-breakpoint
ALTER TABLE "smart_scopes" DROP COLUMN "library_id";--> statement-breakpoint
ALTER TABLE "smart_scopes" ADD CONSTRAINT "smart_scopes_user_id_name_unique" UNIQUE("user_id","name");