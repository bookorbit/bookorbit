ALTER TABLE "book_metadata" ADD COLUMN "cover_updated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "book_metadata" SET "cover_updated_at" = "updated_at";
