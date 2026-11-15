ALTER TABLE "read_aloud_jobs" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD COLUMN "user_order" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_user_started_idx" ON "read_aloud_jobs" USING btree ("requested_by_user_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_user_lane_idx" ON "read_aloud_jobs" USING btree ("requested_by_user_id","user_order") WHERE "read_aloud_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_finish_idx" ON "read_aloud_jobs" USING btree (coalesce("completed_at", "updated_at") desc,"id" desc) WHERE "read_aloud_jobs"."status" in ('completed', 'completed_with_warnings', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "read_aloud_jobs_user_finish_idx" ON "read_aloud_jobs" USING btree ("requested_by_user_id",coalesce("completed_at", "updated_at") desc,"id" desc) WHERE "read_aloud_jobs"."status" in ('completed', 'completed_with_warnings', 'failed', 'cancelled');