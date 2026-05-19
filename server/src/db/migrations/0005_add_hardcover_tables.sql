CREATE TABLE "hardcover_book_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"hardcover_book_id" integer,
	"hardcover_edition_id" integer,
	"hardcover_user_book_id" integer,
	"hardcover_read_id" integer,
	"match_method" varchar(10),
	"match_error" text,
	"last_synced_at" timestamp with time zone,
	"last_synced_status" varchar(20),
	"last_synced_progress" real,
	"last_synced_rating" integer,
	"last_synced_started_at" varchar(10),
	"last_synced_finished_at" varchar(10),
	"sync_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hardcover_book_state_user_book_uidx" UNIQUE("user_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "hardcover_user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"api_token" varchar(2048) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"auto_sync_on_status_change" boolean DEFAULT true NOT NULL,
	"auto_sync_on_progress_update" boolean DEFAULT true NOT NULL,
	"auto_sync_on_rating_change" boolean DEFAULT true NOT NULL,
	"privacy_setting_id" integer DEFAULT 3 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hardcover_user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "hardcover_book_state" ADD CONSTRAINT "hardcover_book_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardcover_book_state" ADD CONSTRAINT "hardcover_book_state_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hardcover_user_settings" ADD CONSTRAINT "hardcover_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;