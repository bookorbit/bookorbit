CREATE TABLE "book_duplicate_group_members" (
	"group_id" integer NOT NULL,
	"scan_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	CONSTRAINT "book_duplicate_group_members_scan_id_book_id_pk" PRIMARY KEY("scan_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "book_duplicate_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer NOT NULL,
	"root_book_id" integer NOT NULL,
	"reasons" text[] NOT NULL,
	"max_title_similarity" real,
	"member_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "book_duplicate_pairs" (
	"scan_id" integer NOT NULL,
	"group_id" integer,
	"book_id_a" integer NOT NULL,
	"book_id_b" integer NOT NULL,
	"reasons" text[] NOT NULL,
	"title_similarity" real,
	CONSTRAINT "book_duplicate_pairs_scan_id_book_id_a_book_id_b_pk" PRIMARY KEY("scan_id","book_id_a","book_id_b"),
	CONSTRAINT "book_duplicate_pairs_order_chk" CHECK ("book_duplicate_pairs"."book_id_a" < "book_duplicate_pairs"."book_id_b")
);
--> statement-breakpoint
CREATE TABLE "book_duplicate_scan_keys" (
	"scan_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "book_duplicate_scan_keys_scan_id_book_id_kind_value_pk" PRIMARY KEY("scan_id","book_id","kind","value"),
	CONSTRAINT "book_duplicate_scan_keys_kind_chk" CHECK ("book_duplicate_scan_keys"."kind" in ('file_hash', 'isbn', 'exact_metadata'))
);
--> statement-breakpoint
CREATE TABLE "book_duplicate_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"library_ids" integer[] NOT NULL,
	"requested_library_id" integer,
	"similarity_percent" integer NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"processed_books" integer DEFAULT 0 NOT NULL,
	"total_books" integer,
	"total_groups" integer,
	"error_code" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "book_duplicate_scans_similarity_chk" CHECK ("book_duplicate_scans"."similarity_percent" between 70 and 100),
	CONSTRAINT "book_duplicate_scans_status_chk" CHECK ("book_duplicate_scans"."status" in ('queued', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "book_duplicate_group_members" ADD CONSTRAINT "book_duplicate_group_members_group_id_book_duplicate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."book_duplicate_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_group_members" ADD CONSTRAINT "book_duplicate_group_members_scan_id_book_duplicate_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."book_duplicate_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_group_members" ADD CONSTRAINT "book_duplicate_group_members_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD CONSTRAINT "book_duplicate_groups_scan_id_book_duplicate_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."book_duplicate_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD CONSTRAINT "book_duplicate_groups_root_book_id_books_id_fk" FOREIGN KEY ("root_book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD CONSTRAINT "book_duplicate_pairs_scan_id_book_duplicate_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."book_duplicate_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD CONSTRAINT "book_duplicate_pairs_group_id_book_duplicate_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."book_duplicate_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD CONSTRAINT "book_duplicate_pairs_book_id_a_books_id_fk" FOREIGN KEY ("book_id_a") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_pairs" ADD CONSTRAINT "book_duplicate_pairs_book_id_b_books_id_fk" FOREIGN KEY ("book_id_b") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_scan_keys" ADD CONSTRAINT "book_duplicate_scan_keys_scan_id_book_duplicate_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."book_duplicate_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_scan_keys" ADD CONSTRAINT "book_duplicate_scan_keys_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_scans" ADD CONSTRAINT "book_duplicate_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_duplicate_group_members_group_idx" ON "book_duplicate_group_members" USING btree ("group_id","book_id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_duplicate_groups_scan_root_uidx" ON "book_duplicate_groups" USING btree ("scan_id","root_book_id");--> statement-breakpoint
CREATE INDEX "book_duplicate_groups_scan_id_idx" ON "book_duplicate_groups" USING btree ("scan_id","id");--> statement-breakpoint
CREATE INDEX "book_duplicate_groups_scan_member_count_idx" ON "book_duplicate_groups" USING btree ("scan_id","member_count");--> statement-breakpoint
CREATE INDEX "book_duplicate_pairs_group_idx" ON "book_duplicate_pairs" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "book_duplicate_pairs_scan_a_idx" ON "book_duplicate_pairs" USING btree ("scan_id","book_id_a");--> statement-breakpoint
CREATE INDEX "book_duplicate_pairs_scan_b_idx" ON "book_duplicate_pairs" USING btree ("scan_id","book_id_b");--> statement-breakpoint
CREATE INDEX "book_duplicate_scan_keys_lookup_idx" ON "book_duplicate_scan_keys" USING btree ("scan_id","kind","value","book_id");--> statement-breakpoint
CREATE INDEX "book_duplicate_scans_user_created_idx" ON "book_duplicate_scans" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "book_duplicate_scans_status_idx" ON "book_duplicate_scans" USING btree ("status");