CREATE TABLE "book_provider_ids" (
	"book_id" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"external_id" varchar(512) NOT NULL,
	"source_url" varchar(2048),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_provider_ids_book_id_provider_pk" PRIMARY KEY("book_id","provider")
);
--> statement-breakpoint
CREATE TABLE "metadata_http_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(32) NOT NULL,
	"base_url" text NOT NULL,
	"authorization_enc" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"allow_private_address" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"info" jsonb,
	"info_fetched_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ok' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metadata_http_providers_timeout_chk" CHECK ("metadata_http_providers"."timeout_ms" >= 2000 and "metadata_http_providers"."timeout_ms" <= 30000),
	CONSTRAINT "metadata_http_providers_status_chk" CHECK ("metadata_http_providers"."status" in ('ok', 'stale', 'unreachable', 'key_changed', 'incompatible')),
	CONSTRAINT "metadata_http_providers_failures_chk" CHECK ("metadata_http_providers"."consecutive_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "book_provider_ids" ADD CONSTRAINT "book_provider_ids_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metadata_http_providers" ADD CONSTRAINT "metadata_http_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_provider_ids_provider_external_id_idx" ON "book_provider_ids" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "metadata_http_providers_key_uq" ON "metadata_http_providers" USING btree ("key");