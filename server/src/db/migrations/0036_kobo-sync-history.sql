CREATE TABLE "kobo_sync_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer,
	"event" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_ms" integer NOT NULL,
	"error_class" varchar(128),
	"error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_sync_history_event_chk" CHECK ("kobo_sync_history"."event" in ('library_sync', 'book_download', 'progress_update', 'annotations_pull', 'annotations_push')),
	CONSTRAINT "kobo_sync_history_status_chk" CHECK ("kobo_sync_history"."status" in ('success', 'failed')),
	CONSTRAINT "kobo_sync_history_duration_nonnegative_chk" CHECK ("kobo_sync_history"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "kobo_sync_history" ADD CONSTRAINT "kobo_sync_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_sync_history" ADD CONSTRAINT "kobo_sync_history_device_id_kobo_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."kobo_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kobo_sync_history_user_created_idx" ON "kobo_sync_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "kobo_sync_history_device_created_idx" ON "kobo_sync_history" USING btree ("device_id","created_at");