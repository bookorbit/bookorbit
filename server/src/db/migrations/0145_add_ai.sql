CREATE TABLE "ai_budget_reservations" (
	"job_id" varchar(64) PRIMARY KEY NOT NULL,
	"feature" varchar(60) NOT NULL,
	"month" varchar(7) NOT NULL,
	"amount_micros" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "ai_budget_reservations_amount_chk" CHECK ("ai_budget_reservations"."amount_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"api_type" varchar(40) NOT NULL,
	"base_url" text NOT NULL,
	"key_encrypted" text,
	"key_hint" varchar(8),
	"headers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"headers_encrypted" text,
	"network_profile" jsonb,
	"timeout_ms" integer DEFAULT 120000 NOT NULL,
	"max_parallel" integer DEFAULT 8 NOT NULL,
	"requests_per_minute" integer,
	"last_test" jsonb,
	"failing_since" timestamp with time zone,
	"failing_code" varchar(40),
	"failing_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_connections_timeout_chk" CHECK ("ai_connections"."timeout_ms" between 10000 and 600000),
	CONSTRAINT "ai_connections_parallel_chk" CHECK ("ai_connections"."max_parallel" between 1 and 32),
	CONSTRAINT "ai_connections_rpm_chk" CHECK ("ai_connections"."requests_per_minute" is null or "ai_connections"."requests_per_minute" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"month" varchar(7) NOT NULL,
	"feature" varchar(60) NOT NULL,
	"slot" varchar(20) NOT NULL,
	"connection_id" integer,
	"model" varchar(200) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cached_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint,
	"duration_ms" integer NOT NULL,
	"outcome" varchar(60) NOT NULL,
	"job_id" varchar(64),
	"attempt" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_monthly" (
	"id" serial PRIMARY KEY NOT NULL,
	"month" varchar(7) NOT NULL,
	"feature" varchar(60) NOT NULL,
	"slot" varchar(20) NOT NULL,
	"connection_id" integer,
	"model" varchar(200) NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"reasoning_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"unknown_cost_requests" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_artifacts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feature" varchar(40) NOT NULL,
	"subject_key" varchar(128) NOT NULL,
	"format" smallint NOT NULL,
	"pipeline" varchar(40) NOT NULL,
	"generation" integer NOT NULL,
	"payload" "bytea" NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"size" integer NOT NULL,
	"coverage" double precision NOT NULL,
	"models" jsonb,
	"cost_micros" bigint,
	"job_id" uuid,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_artifacts_coverage_chk" CHECK ("ai_artifacts"."coverage" >= 0 and "ai_artifacts"."coverage" <= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_job_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"level" varchar(5) NOT NULL,
	"step" varchar(40),
	"code" varchar(60) NOT NULL,
	"data" jsonb,
	CONSTRAINT "ai_job_events_level_chk" CHECK ("ai_job_events"."level" in ('info', 'warn', 'error'))
);
--> statement-breakpoint
CREATE TABLE "ai_job_steps" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feature" varchar(40) NOT NULL,
	"subject_key" varchar(128) NOT NULL,
	"step" varchar(40) NOT NULL,
	"unit" varchar(64) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"generation" integer NOT NULL,
	"outcome" varchar(10) DEFAULT 'ok' NOT NULL,
	"skip_reason" varchar(20),
	"result" jsonb,
	"model" varchar(200),
	"tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" bigint,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_job_steps_outcome_chk" CHECK ("ai_job_steps"."outcome" in ('ok', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" varchar(40) NOT NULL,
	"kind" varchar(10) NOT NULL,
	"subject_key" varchar(128) NOT NULL,
	"subject_ref" jsonb NOT NULL,
	"pipeline" varchar(40) NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"phase" varchar(40),
	"done" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"reason" varchar(40),
	"requested_by" integer,
	"lease_owner" varchar(64),
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"models" jsonb,
	"estimate" jsonb,
	"tokens" bigint DEFAULT 0 NOT NULL,
	"cost_micros" bigint,
	"cap_raises" smallint DEFAULT 0 NOT NULL,
	"paused_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "ai_jobs_status_chk" CHECK ("ai_jobs"."status" in ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "ai_jobs_kind_chk" CHECK ("ai_jobs"."kind" in ('build', 'update', 'rebuild')),
	CONSTRAINT "ai_jobs_counts_chk" CHECK ("ai_jobs"."done" >= 0 and "ai_jobs"."total" >= 0 and "ai_jobs"."attempts" >= 0 and "ai_jobs"."generation" >= 1)
);
--> statement-breakpoint
CREATE TABLE "ai_step_timings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"feature" varchar(40) NOT NULL,
	"step" varchar(40) NOT NULL,
	"connection_id" integer NOT NULL,
	"model" varchar(200) NOT NULL,
	"units" integer NOT NULL,
	"lanes" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_step_timings_counts_chk" CHECK ("ai_step_timings"."units" > 0 and "ai_step_timings"."lanes" > 0 and "ai_step_timings"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "book_file_texts" (
	"file_id" integer PRIMARY KEY NOT NULL,
	"size_bytes" bigint,
	"mtime" timestamp with time zone,
	"extraction_version" smallint NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"text_key" varchar(64),
	"previous_key" varchar(64),
	"language" varchar(16),
	"words" integer DEFAULT 0 NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_file_texts_outcome_chk" CHECK ("book_file_texts"."outcome" in ('ready', 'unreadable', 'too-large')),
	CONSTRAINT "book_file_texts_ready_key_chk" CHECK ("book_file_texts"."outcome" <> 'ready' or "book_file_texts"."text_key" is not null)
);
--> statement-breakpoint
CREATE TABLE "story_guide_fixes" (
	"text_key" varchar(64) NOT NULL,
	"id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"target" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"from_section" integer,
	"from_offset" integer,
	"client_updated_at" timestamp with time zone NOT NULL,
	"made_at" timestamp with time zone NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"revision" bigserial NOT NULL,
	"updated_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_guide_fixes_text_key_id_pk" PRIMARY KEY("text_key","id"),
	CONSTRAINT "story_guide_fixes_kind_not_empty_chk" CHECK (char_length("story_guide_fixes"."kind") >= 1),
	CONSTRAINT "story_guide_fixes_target_object_chk" CHECK (jsonb_typeof("story_guide_fixes"."target") = 'object'),
	CONSTRAINT "story_guide_fixes_data_object_chk" CHECK (jsonb_typeof("story_guide_fixes"."data") = 'object'),
	CONSTRAINT "story_guide_fixes_from_chk" CHECK (("story_guide_fixes"."from_section" is null and "story_guide_fixes"."from_offset" is null) or ("story_guide_fixes"."from_section" >= 0 and "story_guide_fixes"."from_offset" >= 0))
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_connection_id_ai_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_artifacts" ADD CONSTRAINT "ai_artifacts_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_job_events" ADD CONSTRAINT "ai_job_events_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_job_steps" ADD CONSTRAINT "ai_job_steps_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_step_timings" ADD CONSTRAINT "ai_step_timings_connection_id_ai_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."ai_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_step_timings" ADD CONSTRAINT "ai_step_timings_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_file_texts" ADD CONSTRAINT "book_file_texts_file_id_book_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_guide_fixes" ADD CONSTRAINT "story_guide_fixes_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_budget_reservations_month_idx" ON "ai_budget_reservations" USING btree ("month","feature");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_connections_name_lower_uidx" ON "ai_connections" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "ai_usage_month_feature_idx" ON "ai_usage" USING btree ("month","feature");--> statement-breakpoint
CREATE INDEX "ai_usage_at_idx" ON "ai_usage" USING btree ("at");--> statement-breakpoint
CREATE INDEX "ai_usage_job_idx" ON "ai_usage" USING btree ("job_id") WHERE "ai_usage"."job_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_monthly_key_uidx" ON "ai_usage_monthly" USING btree ("month","feature","slot","model",coalesce("connection_id", 0));--> statement-breakpoint
CREATE UNIQUE INDEX "ai_artifacts_subject_uidx" ON "ai_artifacts" USING btree ("feature","subject_key");--> statement-breakpoint
CREATE INDEX "ai_artifacts_job_idx" ON "ai_artifacts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ai_job_events_job_idx" ON "ai_job_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_job_steps_unit_uidx" ON "ai_job_steps" USING btree ("feature","subject_key","step","unit","fingerprint");--> statement-breakpoint
CREATE INDEX "ai_job_steps_subject_generation_idx" ON "ai_job_steps" USING btree ("feature","subject_key","generation");--> statement-breakpoint
CREATE INDEX "ai_job_steps_used_at_idx" ON "ai_job_steps" USING btree ("used_at");--> statement-breakpoint
CREATE INDEX "ai_job_steps_job_idx" ON "ai_job_steps" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_unfinished_subject_uidx" ON "ai_jobs" USING btree ("feature","subject_key") WHERE "ai_jobs"."status" in ('queued', 'running', 'paused');--> statement-breakpoint
CREATE INDEX "ai_jobs_due_idx" ON "ai_jobs" USING btree ("status","next_attempt_at","created_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_subject_created_idx" ON "ai_jobs" USING btree ("feature","subject_key","created_at" desc);--> statement-breakpoint
CREATE INDEX "ai_jobs_requested_by_idx" ON "ai_jobs" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX "ai_jobs_queue_order_idx" ON "ai_jobs" USING btree ("feature","priority" desc,"next_attempt_at","created_at") WHERE "ai_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "ai_jobs_finished_idx" ON "ai_jobs" USING btree ("finished_at" desc);--> statement-breakpoint
CREATE INDEX "ai_step_timings_key_idx" ON "ai_step_timings" USING btree ("feature","connection_id","model","step","created_at" desc);--> statement-breakpoint
CREATE INDEX "book_file_texts_text_key_idx" ON "book_file_texts" USING btree ("text_key");--> statement-breakpoint
CREATE INDEX "book_file_texts_extraction_version_idx" ON "book_file_texts" USING btree ("extraction_version");--> statement-breakpoint
CREATE INDEX "story_guide_fixes_text_revision_idx" ON "story_guide_fixes" USING btree ("text_key","revision");--> statement-breakpoint
CREATE INDEX "story_guide_fixes_tombstone_idx" ON "story_guide_fixes" USING btree ("updated_at") WHERE "story_guide_fixes"."deleted";--> statement-breakpoint
CREATE INDEX "story_guide_fixes_updated_by_idx" ON "story_guide_fixes" USING btree ("updated_by");