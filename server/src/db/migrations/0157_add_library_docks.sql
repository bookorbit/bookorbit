CREATE TABLE "library_docks" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"folder_name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"target_folder_id" integer,
	"auto_fetch_metadata" boolean,
	"auto_finalize_enabled" boolean,
	"auto_finalize_threshold" integer,
	"auto_finalize_metadata_mode" varchar(20),
	"auto_join" boolean DEFAULT false NOT NULL,
	"keep_original" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_docks_library_id_unique" UNIQUE("library_id"),
	CONSTRAINT "library_docks_auto_finalize_threshold_chk" CHECK ("library_docks"."auto_finalize_threshold" is null or ("library_docks"."auto_finalize_threshold" >= 50 and "library_docks"."auto_finalize_threshold" <= 100)),
	CONSTRAINT "library_docks_auto_finalize_metadata_mode_chk" CHECK ("library_docks"."auto_finalize_metadata_mode" is null or "library_docks"."auto_finalize_metadata_mode" in ('safe_merge', 'fetched_only', 'embedded_only'))
);
--> statement-breakpoint
CREATE TABLE "book_dock_kept_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"absolute_path" text NOT NULL,
	"file_size" bigint NOT NULL,
	"mtime_ms" bigint NOT NULL,
	"dock_id" integer,
	"book_id" integer,
	"ignored" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_dock_kept_files_absolute_path_unique" UNIQUE("absolute_path")
);
--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD COLUMN "dock_id" integer;--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD COLUMN "former_library_name" varchar(255);--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD COLUMN "hold_reason" varchar(40);--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD COLUMN "hold_detail" jsonb;--> statement-breakpoint
ALTER TABLE "library_docks" ADD CONSTRAINT "library_docks_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_docks" ADD CONSTRAINT "library_docks_target_folder_id_library_folders_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_dock_kept_files" ADD CONSTRAINT "book_dock_kept_files_dock_id_library_docks_id_fk" FOREIGN KEY ("dock_id") REFERENCES "public"."library_docks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_dock_kept_files" ADD CONSTRAINT "book_dock_kept_files_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "library_docks_folder_name_lower_uidx" ON "library_docks" USING btree (lower("folder_name"));--> statement-breakpoint
CREATE INDEX "library_docks_target_folder_id_idx" ON "library_docks" USING btree ("target_folder_id");--> statement-breakpoint
CREATE INDEX "book_dock_kept_files_dock_id_idx" ON "book_dock_kept_files" USING btree ("dock_id");--> statement-breakpoint
CREATE INDEX "book_dock_kept_files_book_id_idx" ON "book_dock_kept_files" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD CONSTRAINT "book_dock_files_dock_id_library_docks_id_fk" FOREIGN KEY ("dock_id") REFERENCES "public"."library_docks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_dock_files_dock_id_idx" ON "book_dock_files" USING btree ("dock_id");--> statement-breakpoint
ALTER TABLE "book_dock_files" ADD CONSTRAINT "book_dock_files_hold_reason_chk" CHECK ("book_dock_files"."hold_reason" is null or "book_dock_files"."hold_reason" in ('low_confidence', 'no_destination', 'no_folder', 'not_allowed_in_library', 'duplicate', 'destination_conflict', 'unsupported_layout', 'waiting_for_manager'));