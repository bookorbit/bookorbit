CREATE TABLE "reading_session_sync_cursors" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"source" varchar(32) NOT NULL,
	"source_device_key" varchar(128) NOT NULL,
	"counter" integer NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"last_modified" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_session_sync_cursors_user_id_book_id_source_source_device_key_pk" PRIMARY KEY("user_id","book_id","source","source_device_key"),
	CONSTRAINT "rssc_counter_nonnegative_chk" CHECK ("reading_session_sync_cursors"."counter" >= 0),
	CONSTRAINT "rssc_generation_nonnegative_chk" CHECK ("reading_session_sync_cursors"."generation" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "source_device_key" varchar(128);--> statement-breakpoint
ALTER TABLE "reading_session_sync_cursors" ADD CONSTRAINT "reading_session_sync_cursors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_session_sync_cursors" ADD CONSTRAINT "reading_session_sync_cursors_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rssc_book_id_idx" ON "reading_session_sync_cursors" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "rs_user_book_source_device_started_idx" ON "reading_sessions" USING btree ("user_id","book_id","source","source_device_key","started_at");