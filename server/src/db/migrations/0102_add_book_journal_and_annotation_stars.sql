CREATE TABLE "book_journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"body" text NOT NULL,
	"quote" text,
	"chapter_title" varchar(500),
	"position_percent" real,
	"cfi" varchar(2000),
	"position_seconds" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "book_journal_entries_body_length_chk" CHECK (char_length("book_journal_entries"."body") between 1 and 10000),
	CONSTRAINT "book_journal_entries_quote_length_chk" CHECK ("book_journal_entries"."quote" is null or char_length("book_journal_entries"."quote") <= 5000),
	CONSTRAINT "book_journal_entries_position_percent_range_chk" CHECK ("book_journal_entries"."position_percent" is null or ("book_journal_entries"."position_percent" >= 0 and "book_journal_entries"."position_percent" <= 100)),
	CONSTRAINT "book_journal_entries_position_seconds_nonnegative_chk" CHECK ("book_journal_entries"."position_seconds" is null or "book_journal_entries"."position_seconds" >= 0)
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD COLUMN "starred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book_journal_entries" ADD CONSTRAINT "book_journal_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_journal_entries" ADD CONSTRAINT "book_journal_entries_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_journal_entries_user_client_id_uidx" ON "book_journal_entries" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "book_journal_entries_user_book_created_active_idx" ON "book_journal_entries" USING btree ("user_id","book_id","created_at") WHERE "book_journal_entries"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "book_journal_entries_book_id_idx" ON "book_journal_entries" USING btree ("book_id");