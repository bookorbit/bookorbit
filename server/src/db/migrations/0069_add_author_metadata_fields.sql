ALTER TABLE "authors" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "birth_year" integer;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "death_date" date;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "death_year" integer;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "website" varchar(2048);--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "genres" text[];--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "influences" text[];--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "metadata_provider" varchar(50);--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "metadata_provider_id" varchar(128);