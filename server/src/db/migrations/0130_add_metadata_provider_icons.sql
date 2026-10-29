CREATE TABLE "metadata_http_provider_icons" (
	"provider_id" integer PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"content_type" varchar(32) NOT NULL,
	"hash" varchar(16) NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metadata_http_provider_icons" ADD CONSTRAINT "metadata_http_provider_icons_provider_id_metadata_http_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."metadata_http_providers"("id") ON DELETE cascade ON UPDATE no action;