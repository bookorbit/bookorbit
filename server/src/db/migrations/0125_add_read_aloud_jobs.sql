CREATE TABLE "read_aloud_job_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(5) NOT NULL,
	"stage" varchar(30),
	"code" varchar(60) NOT NULL,
	"message" varchar(500),
	"data" jsonb,
	CONSTRAINT "read_aloud_job_events_level_chk" CHECK ("read_aloud_job_events"."level" in ('info', 'warn', 'error'))
);
--> statement-breakpoint
CREATE TABLE "read_aloud_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" integer NOT NULL,
	"requested_by_user_id" integer,
	"output_file_id" integer,
	"replace_file_id" integer,
	"status" varchar(30) DEFAULT 'queued' NOT NULL,
	"stage" varchar(30) DEFAULT 'queued' NOT NULL,
	"progress" smallint DEFAULT 0 NOT NULL,
	"stage_current" integer,
	"stage_total" integer,
	"stage_unit" varchar(10),
	"input" jsonb NOT NULL,
	"decisions" jsonb DEFAULT '{"chapters":{},"audio":[]}'::jsonb NOT NULL,
	"resume_from" varchar(30),
	"report" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" varchar(50),
	"last_error" varchar(2000),
	"device" varchar(20),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"publish_approved" boolean DEFAULT false NOT NULL,
	"worker_event_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"work_expires_at" timestamp with time zone,
	CONSTRAINT "read_aloud_jobs_status_chk" CHECK ("read_aloud_jobs"."status" in ('queued', 'processing', 'awaiting_review', 'completed', 'completed_with_warnings', 'failed', 'cancelled')),
	CONSTRAINT "read_aloud_jobs_stage_chk" CHECK ("read_aloud_jobs"."stage" in ('queued', 'preparing_audio', 'downloading_model', 'generating_emissions', 'marking_up_ebook', 'aligning', 'validating', 'awaiting_review', 'publishing', 'completed')),
	CONSTRAINT "read_aloud_jobs_stage_unit_chk" CHECK ("read_aloud_jobs"."stage_unit" is null or "read_aloud_jobs"."stage_unit" in ('file', 'track', 'chapter')),
	CONSTRAINT "read_aloud_jobs_progress_chk" CHECK ("read_aloud_jobs"."progress" between 0 and 100),
	CONSTRAINT "read_aloud_jobs_attempt_nonnegative_chk" CHECK ("read_aloud_jobs"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "book_file_hash_history" DROP CONSTRAINT "book_file_hash_history_reason_chk";--> statement-breakpoint
ALTER TABLE "read_aloud_job_events" ADD CONSTRAINT "read_aloud_job_events_job_id_read_aloud_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."read_aloud_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD CONSTRAINT "read_aloud_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD CONSTRAINT "read_aloud_jobs_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD CONSTRAINT "read_aloud_jobs_output_file_id_book_files_id_fk" FOREIGN KEY ("output_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD CONSTRAINT "read_aloud_jobs_replace_file_id_book_files_id_fk" FOREIGN KEY ("replace_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "read_aloud_job_events_job_idx" ON "read_aloud_job_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "read_aloud_jobs_active_book_uidx" ON "read_aloud_jobs" USING btree ("book_id") WHERE "read_aloud_jobs"."status" in ('queued', 'processing', 'awaiting_review');--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_due_idx" ON "read_aloud_jobs" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_book_updated_idx" ON "read_aloud_jobs" USING btree ("book_id","updated_at" desc);--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_user_updated_idx" ON "read_aloud_jobs" USING btree ("requested_by_user_id","updated_at" desc);--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_output_file_idx" ON "read_aloud_jobs" USING btree ("output_file_id");--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_replace_file_idx" ON "read_aloud_jobs" USING btree ("replace_file_id");--> statement-breakpoint
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_reason_chk" CHECK ("book_file_hash_history"."reason" in ('file_write', 'external_change', 'rescan', 'kobo_download', 'read_aloud_replace'));