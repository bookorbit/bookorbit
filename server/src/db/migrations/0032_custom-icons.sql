CREATE TABLE "custom_icons" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"original_file_name" varchar(255) NOT NULL,
	"stored_file_name" varchar(255) NOT NULL,
	"file_size" integer NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_icons_slug_chk" CHECK ("custom_icons"."slug" ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$' or "custom_icons"."slug" ~ '^[a-z0-9]$'),
	CONSTRAINT "custom_icons_file_size_positive_chk" CHECK ("custom_icons"."file_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "smart_scopes" ALTER COLUMN "icon" SET DATA TYPE varchar(100);--> statement-breakpoint
CREATE UNIQUE INDEX "custom_icons_slug_uidx" ON "custom_icons" USING btree ("slug");