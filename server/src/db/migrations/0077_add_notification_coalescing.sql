ALTER TABLE "notifications" ADD COLUMN "group_key" varchar(255);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_updated_at_idx" ON "notifications" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_updated_at_idx" ON "notifications" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_unread_group_key_idx" ON "notifications" USING btree ("user_id","group_key") WHERE "notifications"."read" = false and "notifications"."group_key" is not null;