CREATE TABLE "storygraph_book_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"storygraph_book_id" varchar(64),
	"match_method" varchar(20),
	"match_error" text,
	"last_synced_at" timestamp with time zone,
	"last_synced_status" varchar(20),
	"last_synced_progress" real,
	"sync_error" text,
	"sync_override" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storygraph_book_state_user_book_uidx" UNIQUE("user_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "storygraph_user_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_cookie" varchar(4096) NOT NULL,
	"remember_token" varchar(4096) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"book_sync_mode" varchar(20) DEFAULT 'all_eligible' NOT NULL,
	"auto_sync_on_status_change" boolean DEFAULT true NOT NULL,
	"auto_sync_on_progress_update" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storygraph_user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "storygraph_book_state" ADD CONSTRAINT "storygraph_book_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storygraph_book_state" ADD CONSTRAINT "storygraph_book_state_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storygraph_user_settings" ADD CONSTRAINT "storygraph_user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;