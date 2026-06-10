CREATE TABLE "koreader_annotations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"annotation_key" varchar(32) NOT NULL,
	"drawer" varchar(20) NOT NULL,
	"color" varchar(30),
	"text" text,
	"note" text,
	"chapter" varchar(500),
	"pageno" integer,
	"pos_format" varchar(10) NOT NULL,
	"pos0" text NOT NULL,
	"pos1" text,
	"device_created_at" varchar(19) NOT NULL,
	"device_updated_at" varchar(19),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_annotations_drawer_chk" CHECK ("koreader_annotations"."drawer" in ('lighten', 'underscore', 'strikeout', 'invert')),
	CONSTRAINT "koreader_annotations_pos_format_chk" CHECK ("koreader_annotations"."pos_format" in ('xpointer', 'pdf'))
);
--> statement-breakpoint
CREATE TABLE "koreader_device_sweeps" (
	"user_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"device_model" varchar(100) DEFAULT 'KOReader' NOT NULL,
	"plugin_version" varchar(20),
	"last_sweep_at" timestamp with time zone NOT NULL,
	"last_sweep_books_matched" integer DEFAULT 0 NOT NULL,
	"last_sweep_page_stats" integer DEFAULT 0 NOT NULL,
	"last_sweep_annotations" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_device_sweeps_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "koreader_page_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"page" integer NOT NULL,
	"start_time" bigint NOT NULL,
	"duration_seconds" integer NOT NULL,
	"total_pages" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_page_stats_duration_nonnegative_chk" CHECK ("koreader_page_stats"."duration_seconds" >= 0),
	CONSTRAINT "koreader_page_stats_page_nonnegative_chk" CHECK ("koreader_page_stats"."page" >= 0),
	CONSTRAINT "koreader_page_stats_total_pages_positive_chk" CHECK ("koreader_page_stats"."total_pages" > 0),
	CONSTRAINT "koreader_page_stats_start_time_positive_chk" CHECK ("koreader_page_stats"."start_time" > 0)
);
--> statement-breakpoint
ALTER TABLE "koreader_annotations" ADD CONSTRAINT "koreader_annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_annotations" ADD CONSTRAINT "koreader_annotations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_annotations" ADD CONSTRAINT "koreader_annotations_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_device_sweeps" ADD CONSTRAINT "koreader_device_sweeps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_page_stats" ADD CONSTRAINT "koreader_page_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_page_stats" ADD CONSTRAINT "koreader_page_stats_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "koreader_annotations_user_file_key_uidx" ON "koreader_annotations" USING btree ("user_id","book_file_id","annotation_key");--> statement-breakpoint
CREATE INDEX "koreader_annotations_user_book_idx" ON "koreader_annotations" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE INDEX "kds_user_id_idx" ON "koreader_device_sweeps" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kps_user_file_device_page_start_uidx" ON "koreader_page_stats" USING btree ("user_id","book_file_id","device_id","page","start_time");--> statement-breakpoint
CREATE INDEX "kps_user_file_device_start_idx" ON "koreader_page_stats" USING btree ("user_id","book_file_id","device_id","start_time");--> statement-breakpoint
CREATE INDEX "kps_user_id_idx" ON "koreader_page_stats" USING btree ("user_id");