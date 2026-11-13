CREATE TABLE "ai_answer_cache" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key_hash" char(64) NOT NULL,
	"feature" varchar(60) NOT NULL,
	"kind" varchar(40) NOT NULL,
	"answer" text NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "user_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_answer_cache_key_uidx" ON "ai_answer_cache" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "ai_answer_cache_accessed_idx" ON "ai_answer_cache" USING btree ("last_accessed_at");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_month_feature_user_idx" ON "ai_usage" USING btree ("month","feature","user_id") WHERE "ai_usage"."user_id" is not null;