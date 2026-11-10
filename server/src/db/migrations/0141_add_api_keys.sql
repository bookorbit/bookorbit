CREATE TABLE "api_key_libraries" (
	"api_key_id" integer NOT NULL,
	"library_id" integer NOT NULL,
	CONSTRAINT "api_key_libraries_api_key_id_library_id_pk" PRIMARY KEY("api_key_id","library_id")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_by" integer,
	"name" varchar(100) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_hint" varchar(8) NOT NULL,
	"audience" varchar(20) DEFAULT 'api' NOT NULL,
	"access" varchar(10) DEFAULT 'read' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"admin" boolean DEFAULT false NOT NULL,
	"library_limited" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "api_keys_audience_chk" CHECK ("api_keys"."audience" in ('api', 'opds', 'koreader')),
	CONSTRAINT "api_keys_access_chk" CHECK ("api_keys"."access" in ('read', 'write')),
	CONSTRAINT "api_keys_admin_not_library_limited_chk" CHECK (not ("api_keys"."admin" and "api_keys"."library_limited")),
	CONSTRAINT "api_keys_expires_after_created_chk" CHECK ("api_keys"."expires_at" is null or "api_keys"."expires_at" > "api_keys"."created_at")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "api_key_id" integer;--> statement-breakpoint
ALTER TABLE "api_key_libraries" ADD CONSTRAINT "api_key_libraries_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_libraries" ADD CONSTRAINT "api_key_libraries_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_libraries_library_idx" ON "api_key_libraries" USING btree ("library_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_active_idx" ON "api_keys" USING btree ("user_id") WHERE "api_keys"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_api_key_id" ON "audit_log" USING btree ("api_key_id");