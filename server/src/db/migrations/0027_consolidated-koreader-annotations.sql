CREATE TABLE "annotation_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"annotation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer,
	"format" varchar(12) NOT NULL,
	"pos0" text,
	"pos1" text,
	"status" varchar(10) DEFAULT 'exact' NOT NULL,
	"converter_version" integer,
	"extras" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotation_positions_format_chk" CHECK ("annotation_positions"."format" in ('cfi', 'xpointer', 'pdf', 'kobo_span')),
	CONSTRAINT "annotation_positions_status_chk" CHECK ("annotation_positions"."status" in ('exact', 'repaired', 'failed', 'pending')),
	CONSTRAINT "annotation_positions_pos0_chk" CHECK ("annotation_positions"."status" in ('failed', 'pending') or "annotation_positions"."pos0" is not null)
);
--> statement-breakpoint
CREATE TABLE "annotation_sync_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"annotation_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"source" varchar(10) NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"external_key" varchar(64) NOT NULL,
	"external_created_at" varchar(19),
	"last_applied_version" integer DEFAULT 0 NOT NULL,
	"delete_acked_at" timestamp with time zone,
	"first_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "annotation_sync_state_source_chk" CHECK ("annotation_sync_state"."source" in ('koreader', 'kobo'))
);
--> statement-breakpoint
CREATE TABLE "koreader_device_sweeps" (
	"user_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"device_model" varchar(100) DEFAULT 'KOReader' NOT NULL,
	"plugin_version" varchar(20),
	"last_sweep_at" timestamp with time zone NOT NULL,
	"last_sweep_books_matched" integer DEFAULT 0 NOT NULL,
	"last_sweep_page_stats" integer DEFAULT 0 NOT NULL,
	"last_sweep_annotations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_device_sweeps_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "koreader_page_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"page" integer NOT NULL,
	"start_time" bigint NOT NULL,
	"duration_seconds" integer NOT NULL,
	"total_pages" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_page_stats_duration_nonnegative_chk" CHECK ("koreader_page_stats"."duration_seconds" >= 0),
	CONSTRAINT "koreader_page_stats_page_nonnegative_chk" CHECK ("koreader_page_stats"."page" >= 0),
	CONSTRAINT "koreader_page_stats_total_pages_positive_chk" CHECK ("koreader_page_stats"."total_pages" > 0),
	CONSTRAINT "koreader_page_stats_start_time_positive_chk" CHECK ("koreader_page_stats"."start_time" > 0)
);
--> statement-breakpoint
ALTER TABLE "annotations" DROP CONSTRAINT "annotations_style_chk";--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "origin" varchar(10) DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "device_created_at" varchar(19);--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "device_updated_at" varchar(19);--> statement-breakpoint
ALTER TABLE "annotation_positions" ADD CONSTRAINT "annotation_positions_annotation_id_annotations_id_fk" FOREIGN KEY ("annotation_id") REFERENCES "public"."annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_positions" ADD CONSTRAINT "annotation_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_positions" ADD CONSTRAINT "annotation_positions_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_sync_state" ADD CONSTRAINT "annotation_sync_state_annotation_id_annotations_id_fk" FOREIGN KEY ("annotation_id") REFERENCES "public"."annotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotation_sync_state" ADD CONSTRAINT "annotation_sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_device_sweeps" ADD CONSTRAINT "koreader_device_sweeps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_page_stats" ADD CONSTRAINT "koreader_page_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_page_stats" ADD CONSTRAINT "koreader_page_stats_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "annotation_positions_annotation_format_uidx" ON "annotation_positions" USING btree ("annotation_id","format");--> statement-breakpoint
CREATE INDEX "annotation_positions_user_idx" ON "annotation_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "annotation_positions_format_status_idx" ON "annotation_positions" USING btree ("format","status");--> statement-breakpoint
CREATE UNIQUE INDEX "annotation_sync_state_annotation_source_device_uidx" ON "annotation_sync_state" USING btree ("annotation_id","source","device_id");--> statement-breakpoint
CREATE INDEX "annotation_sync_state_user_source_device_key_idx" ON "annotation_sync_state" USING btree ("user_id","source","device_id","external_key");--> statement-breakpoint
CREATE INDEX "annotation_sync_state_user_key_idx" ON "annotation_sync_state" USING btree ("user_id","external_key");--> statement-breakpoint
CREATE INDEX "annotation_sync_state_annotation_id_idx" ON "annotation_sync_state" USING btree ("annotation_id");--> statement-breakpoint
CREATE INDEX "kds_user_id_idx" ON "koreader_device_sweeps" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kps_user_file_device_page_start_uidx" ON "koreader_page_stats" USING btree ("user_id","book_file_id","device_id","page","start_time");--> statement-breakpoint
CREATE INDEX "kps_user_file_device_start_idx" ON "koreader_page_stats" USING btree ("user_id","book_file_id","device_id","start_time");--> statement-breakpoint
CREATE INDEX "kps_user_id_idx" ON "koreader_page_stats" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "annotations_user_book_active_idx" ON "annotations" USING btree ("user_id","book_id") WHERE "annotations"."deleted_at" is null;--> statement-breakpoint
INSERT INTO "annotation_positions" ("annotation_id", "user_id", "format", "pos0", "status", "converter_version")
SELECT "id", "user_id", 'cfi', "cfi", 'exact', 0 FROM "annotations";--> statement-breakpoint
ALTER TABLE "annotations" DROP COLUMN "cfi";--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_origin_chk" CHECK ("annotations"."origin" in ('web', 'koreader', 'kobo'));--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_style_chk" CHECK ("annotations"."style" in ('highlight', 'underline', 'strikethrough', 'squiggly', 'invert'));
