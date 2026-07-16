CREATE TABLE "user_book_notes" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_book_notes_user_id_book_id_pk" PRIMARY KEY("user_id","book_id"),
	CONSTRAINT "user_book_notes_note_length_chk" CHECK ("user_book_notes"."note" is null or char_length("user_book_notes"."note") <= 10000)
);
--> statement-breakpoint
ALTER TABLE "user_book_ratings" DROP CONSTRAINT "user_book_ratings_rating_range_chk";--> statement-breakpoint
ALTER TABLE "user_book_ratings" ALTER COLUMN "rating" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "user_book_notes" ADD CONSTRAINT "user_book_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_book_notes" ADD CONSTRAINT "user_book_notes_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ubn_user_id_idx" ON "user_book_notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ubn_book_id_idx" ON "user_book_notes" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "ubn_book_user_idx" ON "user_book_notes" USING btree ("book_id","user_id");--> statement-breakpoint
ALTER TABLE "user_book_ratings" ADD CONSTRAINT "user_book_ratings_rating_range_chk" CHECK ("user_book_ratings"."rating" is null or ("user_book_ratings"."rating" >= 1 and "user_book_ratings"."rating" <= 5));