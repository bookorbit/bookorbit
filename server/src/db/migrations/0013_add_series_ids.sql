CREATE TABLE "book_series" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(500) NOT NULL,
	"normalized_name" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "series_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "book_series_normalized_name_uidx" ON "book_series" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "book_series_name_trgm_idx" ON "book_series" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "book_series_name_lower_idx" ON "book_series" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "book_metadata" ADD CONSTRAINT "book_metadata_series_id_book_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."book_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bm_series_id_idx" ON "book_metadata" USING btree ("series_id");