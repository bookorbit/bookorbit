CREATE TABLE "kobo_device_library_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_device_library_snapshots_device_id_unique" UNIQUE("device_id")
);
--> statement-breakpoint
CREATE TABLE "kobo_device_snapshot_books" (
	"snapshot_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"synced" boolean DEFAULT false NOT NULL,
	"pending_delete" boolean DEFAULT false NOT NULL,
	"is_new" boolean DEFAULT true NOT NULL,
	"removed_by_device" boolean DEFAULT false NOT NULL,
	"needs_legacy_numeric_removal" boolean DEFAULT false NOT NULL,
	"file_hash" varchar(64),
	"delivery_hash" varchar(64),
	"metadata_hash" varchar(64),
	CONSTRAINT "kobo_device_snapshot_books_snapshot_id_book_id_pk" PRIMARY KEY("snapshot_id","book_id")
);
--> statement-breakpoint
ALTER TABLE "kobo_library_snapshots" ADD COLUMN "legacy_device_cutoff_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "kobo_device_library_snapshots" ADD CONSTRAINT "kobo_device_library_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_library_snapshots" ADD CONSTRAINT "kobo_device_library_snapshots_device_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_snapshot_books" ADD CONSTRAINT "kobo_device_snapshot_books_snapshot_id_kobo_device_library_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."kobo_device_library_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_device_snapshot_books" ADD CONSTRAINT "kobo_device_snapshot_books_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kobo_device_library_snapshots_user_id_idx" ON "kobo_device_library_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kobo_device_snapshot_books_snapshot_synced_book_idx" ON "kobo_device_snapshot_books" USING btree ("snapshot_id","synced","book_id");