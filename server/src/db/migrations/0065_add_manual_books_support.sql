ALTER TABLE "books" ALTER COLUMN "library_folder_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "folder_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "origin_type" varchar(20) DEFAULT 'file_system' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_origin_type_chk" CHECK ("books"."origin_type" in ('file_system', 'manual_entry'));