ALTER TABLE "book_files" DROP CONSTRAINT "book_files_book_folder_consistency_fk";
--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_book_folder_consistency_fk" FOREIGN KEY ("book_id","library_folder_id") REFERENCES "public"."books"("id","library_folder_id") ON DELETE cascade ON UPDATE cascade;