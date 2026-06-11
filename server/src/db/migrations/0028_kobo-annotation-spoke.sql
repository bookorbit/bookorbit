ALTER TABLE "kobo_devices" ADD COLUMN "client_device_id" varchar(128);--> statement-breakpoint
ALTER TABLE "kobo_sync_settings" ADD COLUMN "sync_bookorbit_annotations_to_kobo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kobo_devices" ADD CONSTRAINT "kobo_devices_client_device_id_unique" UNIQUE("client_device_id");