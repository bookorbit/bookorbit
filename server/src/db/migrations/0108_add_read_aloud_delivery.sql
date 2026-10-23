CREATE TABLE "kobo_device_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"source_file_id" integer,
	"metadata" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"state" varchar(32) DEFAULT 'offered' NOT NULL,
	"previous_id" uuid,
	"current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kobo_device_reading_states" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"entitlement_id" varchar(255) NOT NULL,
	"delivery_id" uuid,
	"created_at_kobo" varchar(50),
	"last_modified_kobo" varchar(50),
	"priority_timestamp" varchar(50),
	"current_bookmark" jsonb,
	"statistics" jsonb,
	"status_info" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_device_reading_states_user_id_device_id_book_id_pk" PRIMARY KEY("user_id","device_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "koreader_device_delivery_settings" (
	"user_id" integer NOT NULL,
	"credential_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"read_aloud_delivery" varchar(20),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_device_delivery_settings_user_id_device_id_pk" PRIMARY KEY("user_id","device_id"),
	CONSTRAINT "koreader_device_delivery_chk" CHECK ("koreader_device_delivery_settings"."read_aloud_delivery" in ('original', 'audioless_epub'))
);
--> statement-breakpoint
CREATE TABLE "delivery_artifacts" (
	"selection_id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"scope" varchar(128) NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_inspections" (
	"book_file_id" integer PRIMARY KEY NOT NULL,
	"source_revision" varchar(64) NOT NULL,
	"detector_version" varchar(40) NOT NULL,
	"state" varchar(24) NOT NULL,
	"retry_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opds_users" ADD COLUMN "read_aloud_delivery" varchar(20);--> statement-breakpoint
ALTER TABLE "kobo_device_snapshot_books" ADD COLUMN "delivery_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kobo_device_snapshot_books" ADD COLUMN "delivery_failure_code" varchar(64);--> statement-breakpoint
ALTER TABLE "kobo_sync_settings" ADD COLUMN "read_aloud_delivery" varchar(20);--> statement-breakpoint
ALTER TABLE "email_recipients" ADD COLUMN "read_aloud_delivery" varchar(20);--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "delivery_policy" varchar(20);--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "source_revision" varchar(64);--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "artifact_id" varchar(64);--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "delivery_metadata" jsonb;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "actual_variant" varchar(20);--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "device_type" varchar(20);--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "recipient_id" integer;--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "failure_code" varchar(64);--> statement-breakpoint
ALTER TABLE "email_send_log" ADD COLUMN "dispatch_phase" varchar(32);--> statement-breakpoint
ALTER TABLE "koreader_users" ADD COLUMN "read_aloud_delivery" varchar(20);--> statement-breakpoint
ALTER TABLE "kobo_device_deliveries" ADD CONSTRAINT "kobo_device_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_deliveries" ADD CONSTRAINT "kobo_device_deliveries_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_deliveries" ADD CONSTRAINT "kobo_device_deliveries_source_file_id_book_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_deliveries" ADD CONSTRAINT "kobo_device_deliveries_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_reading_states" ADD CONSTRAINT "kobo_device_reading_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_reading_states" ADD CONSTRAINT "kobo_device_reading_states_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_reading_states" ADD CONSTRAINT "kobo_device_reading_states_delivery_id_kobo_device_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."kobo_device_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_reading_states" ADD CONSTRAINT "kobo_device_reading_states_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_device_delivery_settings" ADD CONSTRAINT "koreader_device_delivery_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_device_delivery_settings" ADD CONSTRAINT "koreader_device_delivery_settings_credential_id_koreader_users_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."koreader_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_artifacts" ADD CONSTRAINT "delivery_artifacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_artifacts" ADD CONSTRAINT "delivery_artifacts_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_inspections" ADD CONSTRAINT "delivery_inspections_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kobo_device_deliveries_current_idx" ON "kobo_device_deliveries" USING btree ("user_id","device_id","book_id") WHERE "kobo_device_deliveries"."current" = true;--> statement-breakpoint
CREATE INDEX "kobo_device_deliveries_device_book_idx" ON "kobo_device_deliveries" USING btree ("user_id","device_id","book_id");--> statement-breakpoint
CREATE INDEX "delivery_artifacts_owner_file_idx" ON "delivery_artifacts" USING btree ("user_id","book_file_id");--> statement-breakpoint
ALTER TABLE "koreader_users" ADD CONSTRAINT "koreader_users_delivery_chk" CHECK ("koreader_users"."read_aloud_delivery" in ('original', 'audioless_epub'));