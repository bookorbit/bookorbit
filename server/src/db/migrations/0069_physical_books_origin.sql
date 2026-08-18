ALTER TABLE "library_folders" ADD COLUMN "kind" varchar(20) DEFAULT 'file_system' NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "origin_type" varchar(20) DEFAULT 'file_system' NOT NULL;--> statement-breakpoint
ALTER TABLE "library_folders" ADD CONSTRAINT "library_folders_kind_chk" CHECK ("library_folders"."kind" in ('file_system', 'manual'));--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_origin_type_chk" CHECK ("books"."origin_type" in ('file_system', 'manual'));