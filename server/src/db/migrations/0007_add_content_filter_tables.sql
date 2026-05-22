CREATE TYPE "public"."content_filter_type" AS ENUM('include', 'exclude');--> statement-breakpoint
CREATE TABLE "user_content_filter_genres" (
	"user_id" integer NOT NULL,
	"filter_type" "content_filter_type" NOT NULL,
	"genre_id" integer NOT NULL,
	CONSTRAINT "user_content_filter_genres_user_id_filter_type_genre_id_pk" PRIMARY KEY("user_id","filter_type","genre_id")
);
--> statement-breakpoint
CREATE TABLE "user_content_filter_tags" (
	"user_id" integer NOT NULL,
	"filter_type" "content_filter_type" NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "user_content_filter_tags_user_id_filter_type_tag_id_pk" PRIMARY KEY("user_id","filter_type","tag_id")
);
--> statement-breakpoint
ALTER TABLE "user_content_filter_genres" ADD CONSTRAINT "user_content_filter_genres_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_content_filter_genres" ADD CONSTRAINT "user_content_filter_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_content_filter_tags" ADD CONSTRAINT "user_content_filter_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_content_filter_tags" ADD CONSTRAINT "user_content_filter_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_content_filter_genres_genre_id_idx" ON "user_content_filter_genres" USING btree ("genre_id");--> statement-breakpoint
CREATE INDEX "user_content_filter_tags_tag_id_idx" ON "user_content_filter_tags" USING btree ("tag_id");