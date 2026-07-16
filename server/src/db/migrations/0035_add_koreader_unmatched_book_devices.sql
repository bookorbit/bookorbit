CREATE TABLE "koreader_unmatched_book_devices" (
	"user_id" integer NOT NULL,
	"hash" varchar(32) NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_unmatched_book_devices_user_id_hash_device_id_pk" PRIMARY KEY("user_id","hash","device_id"),
	CONSTRAINT "koreader_unmatched_book_devices_hash_chk" CHECK ("koreader_unmatched_book_devices"."hash" ~ '^[0-9a-f]{32}$')
);
--> statement-breakpoint
ALTER TABLE "koreader_unmatched_book_devices" ADD CONSTRAINT "koreader_unmatched_book_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "koreader_unmatched_book_devices" ADD CONSTRAINT "koreader_unmatched_book_devices_user_hash_fk" FOREIGN KEY ("user_id","hash") REFERENCES "public"."koreader_unmatched_books"("user_id","hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "koreader_unmatched_book_devices_user_device_idx" ON "koreader_unmatched_book_devices" USING btree ("user_id","device_id");