CREATE TABLE "koreader_device_settings" (
	"user_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"file_naming_pattern" text NOT NULL,
	"series_file_naming_pattern" text,
	"standalone_file_naming_pattern" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_device_settings_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "koreader_user_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"default_file_naming_pattern" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "koreader_device_settings" ADD CONSTRAINT "koreader_device_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_user_settings" ADD CONSTRAINT "koreader_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "koreader_device_settings_user_id_idx" ON "koreader_device_settings" USING btree ("user_id");