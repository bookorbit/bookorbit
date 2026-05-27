CREATE TABLE "koreader_book_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_file_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"total_read_secs" integer DEFAULT 0 NOT NULL,
	"total_read_pages" integer DEFAULT 0 NOT NULL,
	"highlights_count" integer DEFAULT 0 NOT NULL,
	"notes_count" integer DEFAULT 0 NOT NULL,
	"last_open_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "koreader_reading_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_file_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"session_hash" varchar(64) NOT NULL,
	"page" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"total_pages" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "koreader_book_stats" ADD CONSTRAINT "koreader_book_stats_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_book_stats" ADD CONSTRAINT "koreader_book_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_reading_sessions" ADD CONSTRAINT "koreader_reading_sessions_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_reading_sessions" ADD CONSTRAINT "koreader_reading_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_book_stats_user_book_file_uidx" ON "koreader_book_stats" USING btree ("user_id","book_file_id");--> statement-breakpoint
CREATE INDEX "koreader_book_stats_user_idx" ON "koreader_book_stats" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_reading_sessions_session_hash_uidx" ON "koreader_reading_sessions" USING btree ("session_hash");--> statement-breakpoint
CREATE INDEX "koreader_reading_sessions_book_user_started_idx" ON "koreader_reading_sessions" USING btree ("book_file_id","user_id","started_at");--> statement-breakpoint
CREATE INDEX "koreader_reading_sessions_user_idx" ON "koreader_reading_sessions" USING btree ("user_id");