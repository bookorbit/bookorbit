CREATE TABLE "achievements" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"group_key" varchar(64),
	"tier" integer,
	"category" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500) NOT NULL,
	"icon_name" varchar(50) NOT NULL,
	"rarity" varchar(20) NOT NULL,
	"threshold" integer,
	"hidden" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	CONSTRAINT "achievements_category_chk" CHECK ("achievements"."category" in ('reading', 'library', 'exploration', 'dedication')),
	CONSTRAINT "achievements_rarity_chk" CHECK ("achievements"."rarity" in ('common', 'rare', 'epic', 'legendary')),
	CONSTRAINT "achievements_tier_chk" CHECK ("achievements"."tier" is null or ("achievements"."tier" >= 1 and "achievements"."tier" <= 4))
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"achievement_key" varchar(64) NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context_json" jsonb
);
--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_key_achievements_key_fk" FOREIGN KEY ("achievement_key") REFERENCES "public"."achievements"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievements_category_sort_idx" ON "achievements" USING btree ("category","sort_order");--> statement-breakpoint
CREATE INDEX "achievements_group_key_idx" ON "achievements" USING btree ("group_key");--> statement-breakpoint
CREATE UNIQUE INDEX "user_achievements_user_key_uidx" ON "user_achievements" USING btree ("user_id","achievement_key");--> statement-breakpoint
CREATE INDEX "user_achievements_user_id_idx" ON "user_achievements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_achievements_user_awarded_at_idx" ON "user_achievements" USING btree ("user_id","awarded_at");