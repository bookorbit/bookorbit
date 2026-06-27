CREATE TABLE "book_community_ratings" (
	"book_id" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"rating" real NOT NULL,
	"rating_count" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_community_ratings_book_id_provider_pk" PRIMARY KEY("book_id","provider"),
	CONSTRAINT "book_community_ratings_rating_range_chk" CHECK ("book_community_ratings"."rating" >= 0 and "book_community_ratings"."rating" <= 5),
	CONSTRAINT "book_community_ratings_count_nonnegative_chk" CHECK ("book_community_ratings"."rating_count" is null or "book_community_ratings"."rating_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "book_community_ratings" ADD CONSTRAINT "book_community_ratings_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_community_ratings_provider_idx" ON "book_community_ratings" USING btree ("provider");