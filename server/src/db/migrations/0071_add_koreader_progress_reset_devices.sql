CREATE TABLE "koreader_progress_reset_devices" (
	"user_id" integer NOT NULL,
	"book_file_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"converged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_progress_reset_devices_user_id_book_file_id_device_id_pk" PRIMARY KEY("user_id","book_file_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "koreader_progress_reset_devices" ADD CONSTRAINT "koreader_progress_reset_devices_reset_fk" FOREIGN KEY ("user_id","book_file_id") REFERENCES "public"."koreader_progress_resets"("user_id","book_file_id") ON DELETE cascade ON UPDATE no action;