CREATE TABLE "book_duplicate_dismissals" (
	"user_id" integer NOT NULL,
	"book_id_a" integer NOT NULL,
	"book_id_b" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_duplicate_dismissals_user_id_book_id_a_book_id_b_pk" PRIMARY KEY("user_id","book_id_a","book_id_b"),
	CONSTRAINT "book_duplicate_dismissals_order_chk" CHECK ("book_duplicate_dismissals"."book_id_a" < "book_duplicate_dismissals"."book_id_b")
);
--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD COLUMN "confidence" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD COLUMN "member_bytes_total" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD COLUMN "member_bytes_max" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_duplicate_scans" ADD COLUMN "total_extra_copies" integer;--> statement-breakpoint
ALTER TABLE "book_duplicate_scans" ADD COLUMN "total_reclaimable_bytes" bigint;--> statement-breakpoint
ALTER TABLE "book_duplicate_dismissals" ADD CONSTRAINT "book_duplicate_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_dismissals" ADD CONSTRAINT "book_duplicate_dismissals_book_id_a_books_id_fk" FOREIGN KEY ("book_id_a") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_duplicate_dismissals" ADD CONSTRAINT "book_duplicate_dismissals_book_id_b_books_id_fk" FOREIGN KEY ("book_id_b") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_duplicate_dismissals_user_created_idx" ON "book_duplicate_dismissals" USING btree ("user_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "book_duplicate_groups_scan_reclaimable_idx" ON "book_duplicate_groups" USING btree ("scan_id",("member_bytes_total" - "member_bytes_max") desc);--> statement-breakpoint
CREATE INDEX "book_duplicate_groups_scan_confidence_idx" ON "book_duplicate_groups" USING btree ("scan_id","confidence");--> statement-breakpoint
ALTER TABLE "book_duplicate_groups" ADD CONSTRAINT "book_duplicate_groups_confidence_chk" CHECK ("book_duplicate_groups"."confidence" between 1 and 4);