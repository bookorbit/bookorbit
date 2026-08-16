DROP INDEX "reading_progress_user_updated_at_idx";--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "last_read_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "reading_progress" SET "last_read_at" = "updated_at";--> statement-breakpoint
CREATE INDEX "reading_progress_user_last_read_at_idx" ON "reading_progress" USING btree ("user_id","last_read_at");
