CREATE TABLE "server_fonts" (
	"id" serial PRIMARY KEY NOT NULL,
	"uploaded_by" integer,
	"family_name" varchar(200) NOT NULL,
	"original_file_name" varchar(500) NOT NULL,
	"stored_file_name" varchar(500) NOT NULL,
	"format" varchar(10) NOT NULL,
	"weight" integer DEFAULT 400 NOT NULL,
	"style" varchar(10) DEFAULT 'normal' NOT NULL,
	"file_size" integer NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "server_fonts_format_chk" CHECK ("server_fonts"."format" in ('ttf', 'otf', 'woff', 'woff2')),
	CONSTRAINT "server_fonts_weight_chk" CHECK ("server_fonts"."weight" >= 100 and "server_fonts"."weight" <= 900 and "server_fonts"."weight" % 100 = 0),
	CONSTRAINT "server_fonts_style_chk" CHECK ("server_fonts"."style" in ('normal', 'italic'))
);
--> statement-breakpoint
ALTER TABLE "server_fonts" ADD CONSTRAINT "server_fonts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sf_hash_uidx" ON "server_fonts" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sf_family_weight_style_uidx" ON "server_fonts" USING btree ("family_name","weight","style");