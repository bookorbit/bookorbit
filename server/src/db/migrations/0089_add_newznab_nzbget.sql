ALTER TABLE "book_request_downloads" RENAME COLUMN "client_hash" TO "client_key";--> statement-breakpoint
ALTER TABLE "book_request_downloads" DROP CONSTRAINT "book_request_downloads_source_chk";--> statement-breakpoint
ALTER TABLE "download_clients" DROP CONSTRAINT "download_clients_adapter_type_chk";--> statement-breakpoint
DROP INDEX "book_request_downloads_active_hash_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "book_request_downloads_active_hash_uidx" ON "book_request_downloads" USING btree (coalesce("download_client_id", 0),"client_key") WHERE "book_request_downloads"."status" in ('queued', 'downloading', 'completed', 'importing', 'needs_review');--> statement-breakpoint
ALTER TABLE "book_request_downloads" ADD CONSTRAINT "book_request_downloads_source_chk" CHECK ("book_request_downloads"."source" in ('magnet', 'torrent_file', 'direct_url', 'nzb_file'));--> statement-breakpoint
ALTER TABLE "download_clients" ADD CONSTRAINT "download_clients_adapter_type_chk" CHECK ("download_clients"."adapter_type" in ('qbittorrent', 'transmission', 'deluge', 'nzbget'));