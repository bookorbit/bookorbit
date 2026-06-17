CREATE TABLE "book_series_memberships" (
	"book_id" integer NOT NULL,
	"series_id" integer NOT NULL,
	"series_index" real,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_series_memberships_book_id_series_id_pk" PRIMARY KEY("book_id","series_id"),
	CONSTRAINT "book_series_memberships_display_order_nonnegative_chk" CHECK ("book_series_memberships"."display_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "book_series_memberships" ADD CONSTRAINT "book_series_memberships_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_series_memberships" ADD CONSTRAINT "book_series_memberships_series_id_book_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."book_series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "book_series_memberships_book_display_uidx" ON "book_series_memberships" USING btree ("book_id","display_order");--> statement-breakpoint
CREATE INDEX "book_series_memberships_series_index_book_idx" ON "book_series_memberships" USING btree ("series_id","series_index","book_id");--> statement-breakpoint
CREATE INDEX "book_series_memberships_book_display_idx" ON "book_series_memberships" USING btree ("book_id","display_order");