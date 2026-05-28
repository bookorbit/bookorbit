ALTER TABLE "refresh_tokens" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "replaced_by_token_hash" varchar(64);
