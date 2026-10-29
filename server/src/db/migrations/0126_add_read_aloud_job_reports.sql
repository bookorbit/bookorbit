CREATE TABLE "read_aloud_job_reports" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"chapters" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "read_aloud_jobs" ADD COLUMN "coverage" jsonb;--> statement-breakpoint
ALTER TABLE "read_aloud_job_reports" ADD CONSTRAINT "read_aloud_job_reports_job_id_read_aloud_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."read_aloud_jobs"("id") ON DELETE cascade ON UPDATE no action;