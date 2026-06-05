CREATE TABLE "kobo_book_entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"entitlement_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"cover_image_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"needs_legacy_numeric_removal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kobo_book_entitlements_user_book_unique" UNIQUE("user_id","book_id"),
	CONSTRAINT "kobo_book_entitlements_user_entitlement_unique" UNIQUE("user_id","entitlement_id"),
	CONSTRAINT "kobo_book_entitlements_user_cover_unique" UNIQUE("user_id","cover_image_id")
);
--> statement-breakpoint
ALTER TABLE "kobo_sync_settings" ALTER COLUMN "convert_to_kepub" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "kobo_location_source" varchar(4096);--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "kobo_location_type" varchar(64);--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "kobo_location_value" varchar(255);--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "kobo_content_source_progress_percent" real;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "koreader_progress" text;--> statement-breakpoint
ALTER TABLE "kobo_snapshot_books" ADD COLUMN "delivery_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "kobo_sync_settings" ADD COLUMN "two_way_progress_sync" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kobo_book_entitlements" ADD CONSTRAINT "kobo_book_entitlements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_book_entitlements" ADD CONSTRAINT "kobo_book_entitlements_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kobo_book_entitlements_user_id_idx" ON "kobo_book_entitlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kobo_book_entitlements_book_id_idx" ON "kobo_book_entitlements" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_kobo_content_source_progress_range_chk" CHECK ("reading_progress"."kobo_content_source_progress_percent" is null or ("reading_progress"."kobo_content_source_progress_percent" >= 0 and "reading_progress"."kobo_content_source_progress_percent" <= 100));