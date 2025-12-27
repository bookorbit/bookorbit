DROP TABLE "reading_progress";
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"book_file_id" integer PRIMARY KEY NOT NULL,
	"percentage" real DEFAULT 0 NOT NULL,
	"cfi" varchar(2000),
	"page_number" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;
