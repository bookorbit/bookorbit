CREATE TABLE "kobo_bookmark_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"bookmark_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"external_key" varchar(64) NOT NULL,
	"location" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmarks" DROP CONSTRAINT "bookmarks_origin_chk";--> statement-breakpoint
ALTER TABLE "kobo_bookmark_links" ADD CONSTRAINT "kobo_bookmark_links_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_bookmark_links" ADD CONSTRAINT "kobo_bookmark_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_bookmark_links" ADD CONSTRAINT "kobo_bookmark_links_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kobo_bookmark_links" ADD CONSTRAINT "kobo_bookmark_links_owner_fk" FOREIGN KEY ("device_id","user_id") REFERENCES "public"."kobo_devices"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kobo_bookmark_links_bookmark_device_uidx" ON "kobo_bookmark_links" USING btree ("bookmark_id","device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kobo_bookmark_links_device_key_uidx" ON "kobo_bookmark_links" USING btree ("device_id","external_key");--> statement-breakpoint
CREATE INDEX "kobo_bookmark_links_user_device_book_idx" ON "kobo_bookmark_links" USING btree ("user_id","device_id","book_id");--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_origin_chk" CHECK ("bookmarks"."origin" in ('web', 'koreader', 'kobo'));