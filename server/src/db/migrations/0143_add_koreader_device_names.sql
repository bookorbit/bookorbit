CREATE TABLE "koreader_device_names" (
	"user_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"name" varchar(100) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_device_names_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "koreader_device_names" ADD CONSTRAINT "koreader_device_names_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;