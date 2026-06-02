ALTER TABLE "libraries" ADD COLUMN "file_write_audio_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "libraries" ADD COLUMN "file_write_audio_max_file_size_mb" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_file_write_audio_max_size_chk" CHECK ("libraries"."file_write_audio_max_file_size_mb" >= 1);
