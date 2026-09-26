CREATE TABLE "auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_version" integer NOT NULL,
	"authentication_method" varchar(20) NOT NULL,
	"client_kind" varchar(10) DEFAULT 'web' NOT NULL,
	"device_label" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_client_kind_chk" CHECK ("auth_sessions"."client_kind" in ('web', 'native')),
	CONSTRAINT "auth_sessions_authentication_method_chk" CHECK ("auth_sessions"."authentication_method" in ('password', 'oidc', 'magic_link', 'setup', 'legacy'))
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "session_id" integer;--> statement-breakpoint
ALTER TABLE "oidc_sessions" ADD COLUMN "session_id" integer;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_sessions" ADD CONSTRAINT "oidc_sessions_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_session_id_idx" ON "refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_sessions_session_id_idx" ON "oidc_sessions" USING btree ("session_id");