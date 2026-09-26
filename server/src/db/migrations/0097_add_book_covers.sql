CREATE TABLE "book_covers" (
	"book_id" integer NOT NULL,
	"medium" varchar(5) NOT NULL,
	"source" varchar(9) NOT NULL,
	"origin" varchar(12) NOT NULL,
	"width" integer,
	"height" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dormant_since" timestamp with time zone,
	CONSTRAINT "book_covers_book_id_medium_pk" PRIMARY KEY("book_id","medium"),
	CONSTRAINT "book_covers_medium_chk" CHECK ("book_covers"."medium" in ('ebook', 'audio')),
	CONSTRAINT "book_covers_source_chk" CHECK ("book_covers"."source" in ('extracted', 'custom')),
	CONSTRAINT "book_covers_origin_chk" CHECK ("book_covers"."origin" in ('embedded', 'folder_image', 'opf', 'provider', 'dock', 'upload', 'legacy')),
	CONSTRAINT "book_covers_width_positive_chk" CHECK ("book_covers"."width" is null or "book_covers"."width" > 0),
	CONSTRAINT "book_covers_height_positive_chk" CHECK ("book_covers"."height" is null or "book_covers"."height" > 0)
);
--> statement-breakpoint
ALTER TABLE "book_covers" ADD CONSTRAINT "book_covers_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;