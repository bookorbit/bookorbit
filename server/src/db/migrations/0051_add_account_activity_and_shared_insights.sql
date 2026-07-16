CREATE TYPE "public"."reading_insights_sharing_level" AS ENUM('private', 'summary', 'detailed');--> statement-breakpoint
CREATE TABLE "shared_reading_insight_view_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"viewer_user_id" integer NOT NULL,
	"subject_user_id" integer NOT NULL,
	"sharing_level" "reading_insights_sharing_level" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_authenticated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reading_insights_sharing_level" "reading_insights_sharing_level" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reading_insights_consented_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shared_reading_insight_view_sessions" ADD CONSTRAINT "shared_reading_insight_view_sessions_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_reading_insight_view_sessions" ADD CONSTRAINT "shared_reading_insight_view_sessions_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shared_insight_view_subject_created_idx" ON "shared_reading_insight_view_sessions" USING btree ("subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX "shared_insight_view_expires_idx" ON "shared_reading_insight_view_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_audit_reading_insights_access" ON "audit_log" USING btree ("resource","resource_id","action","created_at");--> statement-breakpoint
CREATE INDEX "users_last_authenticated_at_idx" ON "users" USING btree ("last_authenticated_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_reading_insights_consent_chk" CHECK (("users"."reading_insights_sharing_level" = 'private' and "users"."reading_insights_consented_at" is null) or ("users"."reading_insights_sharing_level" <> 'private' and "users"."reading_insights_consented_at" is not null));