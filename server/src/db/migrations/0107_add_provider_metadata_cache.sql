CREATE TABLE "provider_metadata_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_hash" char(64) NOT NULL,
	"namespace" varchar(16) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"operation" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"schema_version" integer NOT NULL,
	"provider_version" integer NOT NULL,
	"config_fingerprint" char(16) NOT NULL,
	"max_candidates" integer,
	"covers_validated" boolean DEFAULT false NOT NULL,
	"payload" text NOT NULL,
	"payload_bytes" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_accessed_at" timestamp with time zone NOT NULL,
	"upstream_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_metadata_cache_key_hash_unique" UNIQUE("key_hash"),
	CONSTRAINT "provider_metadata_cache_namespace_chk" CHECK ("provider_metadata_cache"."namespace" in ('book', 'author')),
	CONSTRAINT "provider_metadata_cache_operation_chk" CHECK ("provider_metadata_cache"."operation" in ('search', 'lookup')),
	CONSTRAINT "provider_metadata_cache_status_chk" CHECK ("provider_metadata_cache"."status" in ('results', 'empty', 'found', 'not_found')),
	CONSTRAINT "provider_metadata_cache_payload_bytes_nonnegative_chk" CHECK ("provider_metadata_cache"."payload_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "author_enrichment_queue" ADD COLUMN "ignore_cache" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "book_metadata_fetch_queue" ADD COLUMN "ignore_cache" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_metadata_cache_ns_provider_fetched_idx" ON "provider_metadata_cache" USING btree ("namespace","provider","fetched_at");--> statement-breakpoint
CREATE INDEX "provider_metadata_cache_last_accessed_idx" ON "provider_metadata_cache" USING btree ("last_accessed_at");