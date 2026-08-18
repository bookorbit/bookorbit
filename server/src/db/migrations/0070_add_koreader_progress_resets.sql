CREATE TABLE "koreader_progress_resets" (
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"reset_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_progress_resets_user_id_book_file_id_pk" PRIMARY KEY("user_id","book_file_id")
);
--> statement-breakpoint
ALTER TABLE "koreader_progress_resets" ADD CONSTRAINT "koreader_progress_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_progress_resets" ADD CONSTRAINT "koreader_progress_resets_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "koreader_progress_resets_book_file_id_idx" ON "koreader_progress_resets" USING btree ("book_file_id");