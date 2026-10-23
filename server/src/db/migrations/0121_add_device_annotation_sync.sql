CREATE TABLE "kobo_annotation_serves" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"etag" text NOT NULL,
	"plan" jsonb NOT NULL,
	"served_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kobo_known_positions" (
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"location_source" varchar(4096) NOT NULL,
	"location_value" varchar(255) NOT NULL,
	"position_set_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_known_positions_user_id_device_id_book_id_pk" PRIMARY KEY("user_id","device_id","book_id")
);
--> statement-breakpoint
ALTER TABLE "annotation_sync_state" ADD COLUMN "device_content" jsonb;--> statement-breakpoint
ALTER TABLE "annotation_sync_state" ADD COLUMN "served_clock" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "content_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "book_file_id" integer;--> statement-breakpoint
ALTER TABLE "kobo_bookmark_links" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kobo_annotation_serves" ADD CONSTRAINT "kobo_annotation_serves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_annotation_serves" ADD CONSTRAINT "kobo_annotation_serves_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_annotation_serves" ADD CONSTRAINT "kobo_annotation_serves_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_known_positions" ADD CONSTRAINT "kobo_known_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_known_positions" ADD CONSTRAINT "kobo_known_positions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_known_positions" ADD CONSTRAINT "kobo_known_positions_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kobo_annotation_serves_device_book_uidx" ON "kobo_annotation_serves" USING btree ("device_id","book_id");--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE set null ON UPDATE no action;