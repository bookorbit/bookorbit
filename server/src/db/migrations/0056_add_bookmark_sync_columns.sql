CREATE TABLE "koreader_bookmark_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"bookmark_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"koreader_key" varchar(32) NOT NULL,
	"device_datetime" varchar(19),
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "origin" varchar(10) DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "device_pos" varchar(4000);--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "pageno" integer;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "koreader_bookmark_links" ADD CONSTRAINT "koreader_bookmark_links_bookmark_id_bookmarks_id_fk" FOREIGN KEY ("bookmark_id") REFERENCES "public"."bookmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_bookmark_links" ADD CONSTRAINT "koreader_bookmark_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_bookmark_links_bookmark_device_uidx" ON "koreader_bookmark_links" USING btree ("bookmark_id","device_id");--> statement-breakpoint
CREATE INDEX "koreader_bookmark_links_user_device_key_idx" ON "koreader_bookmark_links" USING btree ("user_id","device_id","koreader_key");--> statement-breakpoint
CREATE INDEX "koreader_bookmark_links_user_device_idx" ON "koreader_bookmark_links" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "koreader_bookmark_links_bookmark_id_idx" ON "koreader_bookmark_links" USING btree ("bookmark_id");--> statement-breakpoint
CREATE INDEX "bookmarks_deleted_at_idx" ON "bookmarks" USING btree ("deleted_at") WHERE "bookmarks"."deleted_at" is not null;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_origin_chk" CHECK ("bookmarks"."origin" in ('web', 'koreader'));