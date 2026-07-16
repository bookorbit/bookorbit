CREATE TABLE "koreader_book_hash_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"hash" varchar(32) NOT NULL,
	"book_file_id" integer NOT NULL,
	"koreader_title" varchar(500),
	"koreader_authors" text,
	"koreader_last_open" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_book_hash_links_hash_chk" CHECK ("koreader_book_hash_links"."hash" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
CREATE TABLE "koreader_unmatched_books" (
	"user_id" integer NOT NULL,
	"hash" varchar(32) NOT NULL,
	"title" varchar(500),
	"authors" text,
	"last_open" bigint,
	"source" varchar(20) DEFAULT 'statistics' NOT NULL,
	"metadata_ambiguous" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_unmatched_books_user_id_hash_pk" PRIMARY KEY("user_id","hash"),
	CONSTRAINT "koreader_unmatched_books_hash_chk" CHECK ("koreader_unmatched_books"."hash" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "koreader_unmatched_books_source_chk" CHECK ("koreader_unmatched_books"."source" in ('current_file', 'file', 'statistics'))
);
--> statement-breakpoint
ALTER TABLE "koreader_book_hash_links" ADD CONSTRAINT "koreader_book_hash_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_book_hash_links" ADD CONSTRAINT "koreader_book_hash_links_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_unmatched_books" ADD CONSTRAINT "koreader_unmatched_books_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_book_hash_links_user_hash_uidx" ON "koreader_book_hash_links" USING btree ("user_id","hash");--> statement-breakpoint
CREATE INDEX "koreader_book_hash_links_user_updated_idx" ON "koreader_book_hash_links" USING btree ("user_id","updated_at" desc);--> statement-breakpoint
CREATE INDEX "koreader_book_hash_links_book_file_id_idx" ON "koreader_book_hash_links" USING btree ("book_file_id");--> statement-breakpoint
CREATE INDEX "koreader_unmatched_books_user_seen_idx" ON "koreader_unmatched_books" USING btree ("user_id","last_seen_at" desc);