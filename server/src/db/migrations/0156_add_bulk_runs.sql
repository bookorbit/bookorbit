CREATE TABLE "bulk_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(40) NOT NULL,
	"requested_by" integer,
	"credential_kind" varchar(10) NOT NULL,
	"api_key_id" integer,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"subject_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" varchar(50),
	"error" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"actor_username" varchar(255),
	"actor_ip" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	CONSTRAINT "bulk_runs_kind_chk" CHECK ("bulk_runs"."kind" in ('book-refresh-metadata', 'book-re-extract-cover', 'book-embed-audio-cover', 'author-refresh-metadata', 'book-move')),
	CONSTRAINT "bulk_runs_status_chk" CHECK ("bulk_runs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
	CONSTRAINT "bulk_runs_credential_kind_chk" CHECK ("bulk_runs"."credential_kind" in ('session', 'api_key')),
	CONSTRAINT "bulk_runs_counts_nonnegative_chk" CHECK ("bulk_runs"."total" >= 0 and "bulk_runs"."processed" >= 0 and "bulk_runs"."succeeded" >= 0 and "bulk_runs"."failed" >= 0 and "bulk_runs"."skipped" >= 0)
);
--> statement-breakpoint
ALTER TABLE "bulk_runs" ADD CONSTRAINT "bulk_runs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_runs" ADD CONSTRAINT "bulk_runs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_runs_status_created_idx" ON "bulk_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "bulk_runs_requested_by_created_idx" ON "bulk_runs" USING btree ("requested_by","created_at" desc);--> statement-breakpoint
CREATE INDEX "bulk_runs_finished_idx" ON "bulk_runs" USING btree ("finished_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "bulk_runs_requested_by_finished_idx" ON "bulk_runs" USING btree ("requested_by","finished_at" desc,"id" desc);