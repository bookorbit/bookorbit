ALTER TABLE "reading_progress" ADD COLUMN "narration_percentage" real;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "narration_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD COLUMN "text_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_narration_percentage_range_chk" CHECK ("reading_progress"."narration_percentage" is null or ("reading_progress"."narration_percentage" >= 0 and "reading_progress"."narration_percentage" <= 100));