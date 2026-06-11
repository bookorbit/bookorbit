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
CREATE UNIQUE INDEX "annotation_positions_annotation_format_uidx" ON "annotation_positions" USING btree ("annotation_id","format");--> statement-breakpoint
CREATE INDEX "annotation_positions_user_idx" ON "annotation_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "annotation_positions_format_status_idx" ON "annotation_positions" USING btree ("format","status");--> statement-breakpoint
CREATE UNIQUE INDEX "annotation_sync_state_annotation_source_device_uidx" ON "annotation_sync_state" USING btree ("annotation_id","source","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "annotation_sync_state_user_source_device_key_uidx" ON "annotation_sync_state" USING btree ("user_id","source","device_id","external_key");--> statement-breakpoint
CREATE INDEX "annotation_sync_state_user_key_idx" ON "annotation_sync_state" USING btree ("user_id","external_key");--> statement-breakpoint
CREATE INDEX "annotation_sync_state_annotation_id_idx" ON "annotation_sync_state" USING btree ("annotation_id");--> statement-breakpoint
CREATE INDEX "annotations_user_book_active_idx" ON "annotations" USING btree ("user_id","book_id") WHERE "annotations"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_origin_chk" CHECK ("annotations"."origin" in ('web', 'koreader', 'kobo'));--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_style_chk" CHECK ("annotations"."style" in ('highlight', 'underline', 'strikethrough', 'squiggly', 'invert'));--> statement-breakpoint
-- Backfill: web annotation CFIs become 'cfi' position rows (converter_version 0 = pre-converter).
INSERT INTO "annotation_positions" ("annotation_id", "user_id", "format", "pos0", "status", "converter_version")
SELECT "id", "user_id", 'cfi', "cfi", 'exact', 0 FROM "annotations";--> statement-breakpoint
-- The cfi column is dropped in the follow-up migration; relax it now so koreader-origin rows can be inserted.
ALTER TABLE "annotations" ALTER COLUMN "cfi" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "legacy_koreader_id" integer;--> statement-breakpoint
-- Backfill: device annotations become canonical rows (drawer -> canonical style, named color -> hex).
INSERT INTO "annotations" ("user_id", "book_id", "text", "color", "style", "note", "chapter_title", "origin", "version", "device_created_at", "device_updated_at", "created_at", "updated_at", "legacy_koreader_id")
SELECT
  ka."user_id",
  ka."book_id",
  coalesce(ka."text", ''),
  CASE
    WHEN ka."color" = 'red' THEN '#FF3300'
    WHEN ka."color" = 'orange' THEN '#FF8800'
    WHEN ka."color" = 'yellow' THEN '#FFFF33'
    WHEN ka."color" = 'green' THEN '#00AA66'
    WHEN ka."color" = 'olive' THEN '#88FF77'
    WHEN ka."color" = 'cyan' THEN '#00FFEE'
    WHEN ka."color" = 'blue' THEN '#0066FF'
    WHEN ka."color" = 'purple' THEN '#EE00FF'
    WHEN ka."color" = 'gray' THEN '#808080'
    WHEN ka."color" ~* '^#[0-9a-f]{6}$' THEN upper(ka."color")
    WHEN ka."color" ~* '^[0-9a-f]{6}$' THEN upper('#' || ka."color")
    ELSE '#FFFF33'
  END,
  CASE ka."drawer"
    WHEN 'lighten' THEN 'highlight'
    WHEN 'underscore' THEN 'underline'
    WHEN 'strikeout' THEN 'strikethrough'
    ELSE 'invert'
  END,
  ka."note",
  ka."chapter",
  'koreader',
  1,
  ka."device_created_at",
  ka."device_updated_at",
  ka."created_at",
  ka."updated_at",
  ka."id"
FROM "koreader_annotations" ka;--> statement-breakpoint
-- Backfill: device positions (xpointer or pdf) for the migrated rows.
INSERT INTO "annotation_positions" ("annotation_id", "user_id", "book_file_id", "format", "pos0", "pos1", "status", "extras")
SELECT
  a."id",
  ka."user_id",
  ka."book_file_id",
  ka."pos_format",
  ka."pos0",
  ka."pos1",
  'exact',
  CASE WHEN ka."pageno" IS NOT NULL THEN jsonb_build_object('pageno', ka."pageno") ELSE NULL END
FROM "annotations" a
JOIN "koreader_annotations" ka ON ka."id" = a."legacy_koreader_id";--> statement-breakpoint
ALTER TABLE "annotations" DROP COLUMN "legacy_koreader_id";
-- No annotation_sync_state backfill: koreader_annotations never stored a device id. The exchange
-- intake reconciles devices lazily via the derived key md5(device_created_at|pos0); per-device
-- deletion detection self-arms after each device's first exchange.