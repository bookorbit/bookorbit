CREATE TABLE "book_file_audio_timelines" (
	"file_id" integer PRIMARY KEY NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mtime_ms" double precision NOT NULL,
	"total_seconds" double precision,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_file_audio_timelines_total_seconds_nonnegative_chk" CHECK ("book_file_audio_timelines"."total_seconds" is null or "book_file_audio_timelines"."total_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "book_file_audio_timelines" ADD CONSTRAINT "book_file_audio_timelines_file_id_book_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;