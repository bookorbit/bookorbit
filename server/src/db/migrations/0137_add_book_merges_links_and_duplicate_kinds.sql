CREATE TABLE "book_duplicate_resolutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"scan_id" integer,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"current_group_id" integer,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "book_duplicate_resolutions_status_chk" CHECK ("book_duplicate_resolutions"."status" in ('running', 'completed', 'failed')),
	CONSTRAINT "book_duplicate_resolutions_counts_chk" CHECK ("book_duplicate_resolutions"."processed" >= 0 and "book_duplicate_resolutions"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_link_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_book_id" integer,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_links" (
	"book_id" integer PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"linked_by_user_id" integer,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_merge_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"library_id" integer NOT NULL,
	"target_book_id" integer NOT NULL,
	"destination_book_id" integer,
	"source_book_ids" integer[] NOT NULL,
	"requested_by_user_id" integer,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"plan" jsonb NOT NULL,
	"moves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"current_source_book_id" integer,
	"processed" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "book_merge_jobs_status_chk" CHECK ("book_merge_jobs"."status" in ('planned', 'moving', 'committing', 'committed', 'done', 'failed', 'rolled_back')),
	CONSTRAINT "book_merge_jobs_counts_nonnegative_chk" CHECK ("book_merge_jobs"."processed" >= 0 and "book_merge_jobs"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_merges" (
	"source_book_id" integer PRIMARY KEY NOT NULL,
	"target_book_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	"merged_by_user_id" integer,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_id" integer,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kobo_device_entitlement_tombstones" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"legacy_numeric_removal" boolean DEFAULT false NOT NULL,
	CONSTRAINT "kobo_device_entitlement_tombstones_device_id_entitlement_id_pk" PRIMARY KEY("device_id","entitlement_id")
);
--> statement-breakpoint
CREATE TABLE "kobo_entitlement_tombstones" (
	"user_id" integer NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"legacy_book_id" integer,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_entitlement_tombstones_user_id_entitlement_id_pk" PRIMARY KEY("user_id","entitlement_id")
);
--> statement-breakpoint
ALTER TABLE "book_duplicate_scan_keys" DROP CONSTRAINT "book_duplicate_scan_keys_kind_chk";--> statement-breakpoint
DROP INDEX "book_duplicate_group_members_group_idx";--> statement-breakpoint
DROP INDEX "book_duplicate_groups_scan_root_uidx";--> statement-breakpoint
ALTER TABLE "book_duplicate_group_members" DROP CONSTRAINT "book_duplicate_group_members_scan_id_book_id_pk";--> statement-breakpoint
ALTER TABLE "book_duplicate_group_members" ADD CONSTRAINT "book_duplicate_group_members_group_id_book_id_pk" PRIMARY KEY("group_id","book_id");--> statement-breakpoint
ALTER TABLE "book_duplicate_dismissals" ADD COLUMN "kind" varchar(20) DEFAULT 'duplicate' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD COLUMN "kind" varchar(20) DEFAULT 'duplicate' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD COLUMN "kind" varchar(20) DEFAULT 'duplicate' NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_scans" ADD COLUMN "total_other_format_pairs" integer;--> statement-breakpoint
ALTER TABLE "book_duplicate_resolutions" ADD CONSTRAINT "book_duplicate_resolutions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_resolutions" ADD CONSTRAINT "book_duplicate_resolutions_scan_id_book_duplicate_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."book_duplicate_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_link_groups" ADD CONSTRAINT "book_link_groups_lead_book_id_books_id_fk" FOREIGN KEY ("lead_book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_link_groups" ADD CONSTRAINT "book_link_groups_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_links" ADD CONSTRAINT "book_links_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_links" ADD CONSTRAINT "book_links_group_id_book_link_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."book_link_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_links" ADD CONSTRAINT "book_links_linked_by_user_id_users_id_fk" FOREIGN KEY ("linked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merge_jobs" ADD CONSTRAINT "book_merge_jobs_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merge_jobs" ADD CONSTRAINT "book_merge_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merges" ADD CONSTRAINT "book_merges_target_book_id_books_id_fk" FOREIGN KEY ("target_book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merges" ADD CONSTRAINT "book_merges_merged_by_user_id_users_id_fk" FOREIGN KEY ("merged_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_merges" ADD CONSTRAINT "book_merges_job_id_book_merge_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."book_merge_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_entitlement_tombstones" ADD CONSTRAINT "kobo_device_entitlement_tombstones_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_entitlement_tombstones" ADD CONSTRAINT "kobo_device_entitlement_tombstones_tombstone_fk" FOREIGN KEY ("user_id","entitlement_id") REFERENCES "public"."kobo_entitlement_tombstones"("user_id","entitlement_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_entitlement_tombstones" ADD CONSTRAINT "kobo_entitlement_tombstones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_duplicate_resolutions_user_created_idx" ON "book_duplicate_resolutions" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "book_duplicate_resolutions_running_idx" ON "book_duplicate_resolutions" USING btree ("status") WHERE "book_duplicate_resolutions"."status" = 'running';--> statement-breakpoint
CREATE INDEX "book_links_group_book_idx" ON "book_links" USING btree ("group_id","book_id");--> statement-breakpoint
CREATE INDEX "book_merge_jobs_unfinished_idx" ON "book_merge_jobs" USING btree ("status") WHERE "book_merge_jobs"."status" not in ('done', 'failed', 'rolled_back');--> statement-breakpoint
CREATE INDEX "book_merge_jobs_library_idx" ON "book_merge_jobs" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "book_merges_target_book_id_idx" ON "book_merges" USING btree ("target_book_id");--> statement-breakpoint
CREATE INDEX "kobo_device_entitlement_tombstones_user_entitlement_idx" ON "kobo_device_entitlement_tombstones" USING btree ("user_id","entitlement_id");--> statement-breakpoint
CREATE INDEX "kobo_entitlement_tombstones_user_removed_at_idx" ON "kobo_entitlement_tombstones" USING btree ("user_id","removed_at");--> statement-breakpoint
CREATE INDEX "book_duplicate_group_members_scan_book_idx" ON "book_duplicate_group_members" USING btree ("scan_id","book_id");--> statement-breakpoint
CREATE INDEX "book_duplicate_groups_scan_kind_idx" ON "book_duplicate_groups" USING btree ("scan_id","kind","id");--> statement-breakpoint
CREATE INDEX "bm_hardcover_id_idx" ON "book_metadata" USING btree ("hardcover_id") WHERE "book_metadata"."hardcover_id" is not null;--> statement-breakpoint
CREATE INDEX "bm_open_library_id_idx" ON "book_metadata" USING btree ("open_library_id") WHERE "book_metadata"."open_library_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "book_duplicate_groups_scan_root_uidx" ON "book_duplicate_groups" USING btree ("scan_id","root_book_id") WHERE "book_duplicate_groups"."kind" = 'duplicate';--> statement-breakpoint
ALTER TABLE "book_duplicate_dismissals" ADD CONSTRAINT "book_duplicate_dismissals_kind_chk" CHECK ("book_duplicate_dismissals"."kind" in ('duplicate', 'other_format'));--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD CONSTRAINT "book_duplicate_groups_kind_chk" CHECK ("book_duplicate_groups"."kind" in ('duplicate', 'other_format'));--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD CONSTRAINT "book_duplicate_pairs_kind_chk" CHECK ("book_duplicate_pairs"."kind" in ('duplicate', 'other_format'));--> statement-breakpoint
ALTER TABLE "book_duplicate_scan_keys" ADD CONSTRAINT "book_duplicate_scan_keys_kind_chk" CHECK ("book_duplicate_scan_keys"."kind" in ('file_hash', 'isbn', 'exact_metadata', 'of_work', 'of_title', 'of_series'));