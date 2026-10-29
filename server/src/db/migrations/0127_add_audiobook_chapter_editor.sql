CREATE TABLE "book_chapter_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"kind" varchar(10) NOT NULL,
	"base_revision" varchar(64) NOT NULL,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"files_written" integer DEFAULT 0 NOT NULL,
	"files_total" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_chapter_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"chapters" jsonb NOT NULL,
	"source" varchar(20) NOT NULL,
	"chapter_count" integer NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_lookup_queue" (
	"claim_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"book_id" integer PRIMARY KEY NOT NULL,
	"user_id" integer,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"reason" varchar(40),
	"result" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audiobook_manifest_revisions" (
	"book_id" integer NOT NULL,
	"revision" varchar(64) NOT NULL,
	"positions_key" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audiobook_manifest_revisions_book_id_revision_pk" PRIMARY KEY("book_id","revision")
);
--> statement-breakpoint
ALTER TABLE "book_files" ADD COLUMN "chapter_write_provenance" jsonb;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "chapter_count" integer GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(chapters) = 'array' THEN jsonb_array_length(chapters) ELSE 0 END) STORED;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "numbered_chapter_count" integer GENERATED ALWAYS AS (CASE WHEN jsonb_typeof(chapters) = 'array' THEN jsonb_array_length(jsonb_path_query_array(chapters, '$[*] ? (@.title like_regex "^[[:space:]]*((track|disc|cd|part)[[:space:]]*)?[#._-]*[[:space:]]*[0-9]+([[:space:]]*(of|/)[[:space:]]*[0-9]+)?[[:space:]]*$" flag "i")')) ELSE 0 END) STORED;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "manifest_legacy_recorded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "chapters_source" varchar(20);--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "chapters_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN "chapters_updated_by" integer;--> statement-breakpoint
ALTER TABLE "book_chapter_jobs" ADD CONSTRAINT "book_chapter_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chapter_jobs" ADD CONSTRAINT "book_chapter_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chapter_versions" ADD CONSTRAINT "book_chapter_versions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_chapter_versions" ADD CONSTRAINT "book_chapter_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_lookup_queue" ADD CONSTRAINT "chapter_lookup_queue_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_lookup_queue" ADD CONSTRAINT "chapter_lookup_queue_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiobook_manifest_revisions" ADD CONSTRAINT "audiobook_manifest_revisions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bcj_status_created_idx" ON "book_chapter_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bcj_request_idx" ON "book_chapter_jobs" USING btree ("user_id","book_id","kind","base_revision");--> statement-breakpoint
CREATE INDEX "bcv_book_created_idx" ON "book_chapter_versions" USING btree ("book_id","created_at");--> statement-breakpoint
CREATE INDEX "bcv_created_by_idx" ON "book_chapter_versions" USING btree ("created_by") WHERE "book_chapter_versions"."created_by" is not null;--> statement-breakpoint
CREATE INDEX "clq_status_available_idx" ON "chapter_lookup_queue" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "clq_user_status_idx" ON "chapter_lookup_queue" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "amr_book_created_idx" ON "audiobook_manifest_revisions" USING btree ("book_id","created_at");--> statement-breakpoint
ALTER TABLE "book_metadata" ADD CONSTRAINT "book_metadata_chapters_updated_by_users_id_fk" FOREIGN KEY ("chapters_updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bm_chapter_count_idx" ON "book_metadata" USING btree ("chapter_count","book_id");--> statement-breakpoint
CREATE INDEX "bm_numbered_chapters_idx" ON "book_metadata" USING btree ("book_id") WHERE numbered_chapter_count >= chapter_count * 0.8 AND chapter_count >= 2;--> statement-breakpoint
CREATE INDEX "bm_chapters_updated_by_idx" ON "book_metadata" USING btree ("chapters_updated_by") WHERE "book_metadata"."chapters_updated_by" is not null;--> statement-breakpoint
-- Chapter lists stored before their source was recorded. A provider lookup stored a durationMs on
-- every chapter, which a list read from the audio files never carries.
UPDATE "book_metadata"
SET "chapters_source" = CASE WHEN jsonb_path_exists("chapters", '$[*].durationMs') THEN 'provider' ELSE 'embedded' END
WHERE "chapters_source" IS NULL AND jsonb_typeof("chapters") = 'array' AND jsonb_array_length("chapters") > 0;
--> statement-breakpoint
-- A book locked with "lock all" stays fully locked now that chapters can be locked too.
UPDATE "book_metadata"
SET "locked_fields" = array_append("locked_fields", 'chapters')
WHERE "locked_fields" @> ARRAY['title', 'subtitle', 'authors', 'description', 'publisher', 'publishedYear', 'language', 'pageCount', 'seriesName', 'seriesIndex', 'isbn13', 'isbn10', 'genres', 'tags', 'rating', 'communityRating', 'narrators', 'durationSeconds', 'abridged', 'googleBooksId', 'goodreadsId', 'amazonId', 'hardcoverId', 'hardcoverEditionId', 'openLibraryId', 'itunesId', 'audibleId', 'librofmId', 'koboId', 'comicvineId', 'ranobedbId', 'lubimyczytacId', 'aladinId', 'comicIssueNumber', 'comicVolumeName', 'comicStoryArcs', 'comicPencillers', 'comicInkers', 'comicColorists', 'comicLetterers', 'comicCoverArtists', 'comicCharacters', 'comicTeams', 'comicLocations', 'cover', 'audioCover']::text[]
  AND NOT ('chapters' = ANY("locked_fields"));
