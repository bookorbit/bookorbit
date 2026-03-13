CREATE TABLE "author_enrichment_queue" (
	"author_id" integer PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"reason" varchar(50) DEFAULT 'unknown' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp,
	"last_success_at" timestamp,
	"last_error" text,
	"last_http_status" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "author_enrichment_queue" ADD CONSTRAINT "author_enrichment_queue_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "author_enrichment_queue_status_next_attempt_idx" ON "author_enrichment_queue" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "author_enrichment_queue_next_attempt_idx" ON "author_enrichment_queue" USING btree ("next_attempt_at");