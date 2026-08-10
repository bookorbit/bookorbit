CREATE TABLE "book_move_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_by" integer NOT NULL,
	"target_library_id" integer NOT NULL,
	"target_folder_id" integer NOT NULL,
	"source_library_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"total_books" integer DEFAULT 0 NOT NULL,
	"succeeded" integer DEFAULT 0 NOT NULL,
	"merged" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "book_move_jobs_status_chk" CHECK ("book_move_jobs"."status" in ('running', 'completed', 'failed', 'interrupted')),
	CONSTRAINT "book_move_jobs_counts_nonnegative_chk" CHECK ("book_move_jobs"."total_books" >= 0 and "book_move_jobs"."succeeded" >= 0 and "book_move_jobs"."merged" >= 0 and "book_move_jobs"."failed" >= 0 and "book_move_jobs"."skipped" >= 0)
);
--> statement-breakpoint
ALTER TABLE "book_move_jobs" ADD CONSTRAINT "book_move_jobs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_move_jobs" ADD CONSTRAINT "book_move_jobs_target_library_id_libraries_id_fk" FOREIGN KEY ("target_library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_move_jobs" ADD CONSTRAINT "book_move_jobs_target_folder_id_library_folders_id_fk" FOREIGN KEY ("target_folder_id") REFERENCES "public"."library_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_move_jobs_status_idx" ON "book_move_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "book_move_jobs_started_at_idx" ON "book_move_jobs" USING btree ("started_at" desc);