CREATE TABLE "koreader_session_tombstones" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"device_key" varchar(100) NOT NULL,
	"start_time" bigint NOT NULL,
	"end_time" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_session_tombstones_range_chk" CHECK ("koreader_session_tombstones"."end_time" > "koreader_session_tombstones"."start_time")
);
--> statement-breakpoint
ALTER TABLE "koreader_session_tombstones" ADD CONSTRAINT "koreader_session_tombstones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_session_tombstones" ADD CONSTRAINT "koreader_session_tombstones_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kst_user_file_device_start_idx" ON "koreader_session_tombstones" USING btree ("user_id","book_file_id","device_key","start_time");--> statement-breakpoint
CREATE INDEX "koreader_session_tombstones_book_file_id_idx" ON "koreader_session_tombstones" USING btree ("book_file_id");