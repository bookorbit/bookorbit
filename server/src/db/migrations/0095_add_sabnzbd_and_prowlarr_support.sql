CREATE TABLE "request_indexer_managers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(16),
	"type" varchar(30) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"base_url" text NOT NULL,
	"credentials_enc" text NOT NULL,
	"allow_private_address" boolean DEFAULT false NOT NULL,
	"sync_new_indexers" boolean DEFAULT true NOT NULL,
	"per_indexer_timeout_seconds" integer DEFAULT 20 NOT NULL,
	"overall_search_budget_seconds" integer DEFAULT 60 NOT NULL,
	"auto_expand_categories" boolean DEFAULT false NOT NULL,
	"inherit_seed_limits" boolean DEFAULT true NOT NULL,
	"network_profile" jsonb,
	"version" varchar(100),
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_error_message" text,
	"last_synced_at" timestamp with time zone,
	"last_sync_ok" boolean,
	"last_sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_indexer_managers_type_chk" CHECK ("request_indexer_managers"."type" in ('prowlarr')),
	CONSTRAINT "request_indexer_managers_timeout_chk" CHECK ("request_indexer_managers"."per_indexer_timeout_seconds" between 5 and 180),
	CONSTRAINT "request_indexer_managers_budget_chk" CHECK ("request_indexer_managers"."overall_search_budget_seconds" between 5 and 300)
);
--> statement-breakpoint
ALTER TABLE "download_clients" DROP CONSTRAINT "download_clients_adapter_type_chk";--> statement-breakpoint
ALTER TABLE "request_indexers" ADD COLUMN "manager_id" integer;--> statement-breakpoint
ALTER TABLE "request_indexers" ADD COLUMN "manager_external_id" varchar(100);--> statement-breakpoint
ALTER TABLE "request_indexers" ADD COLUMN "manager_available" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "request_indexers" ADD COLUMN "manager_last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "request_indexers" ADD COLUMN "manager_metadata" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "request_indexer_managers_name_lower_uidx" ON "request_indexer_managers" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "request_indexers" ADD CONSTRAINT "request_indexers_manager_id_request_indexer_managers_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."request_indexer_managers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_indexers_manager_external_uidx" ON "request_indexers" USING btree ("manager_id","manager_external_id");--> statement-breakpoint
CREATE INDEX "request_indexers_manager_idx" ON "request_indexers" USING btree ("manager_id");--> statement-breakpoint
ALTER TABLE "download_clients" ADD CONSTRAINT "download_clients_adapter_type_chk" CHECK ("download_clients"."adapter_type" in ('qbittorrent', 'transmission', 'deluge', 'nzbget', 'sabnzbd'));--> statement-breakpoint
ALTER TABLE "request_indexers" ADD CONSTRAINT "request_indexers_manager_fields_chk" CHECK (("request_indexers"."manager_id" is null and "request_indexers"."manager_external_id" is null and "request_indexers"."manager_metadata" is null) or ("request_indexers"."manager_id" is not null and "request_indexers"."manager_external_id" is not null and "request_indexers"."manager_metadata" is not null and "request_indexers"."credentials_enc" is null and "request_indexers"."adapter_type" in ('torznab', 'newznab')));