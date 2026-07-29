ALTER TABLE "libraries" ADD COLUMN "file_write_kindle_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "libraries" ADD COLUMN "file_write_kindle_max_file_size_mb" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "libraries" ADD CONSTRAINT "libraries_file_write_kindle_max_size_chk" CHECK ("libraries"."file_write_kindle_max_file_size_mb" >= 1);