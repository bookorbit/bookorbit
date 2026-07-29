CREATE TABLE "smart_scope_kobo_subscriptions" (
	"user_id" integer NOT NULL,
	"smart_scope_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "smart_scope_kobo_subscriptions_user_id_smart_scope_id_pk" PRIMARY KEY("user_id","smart_scope_id")
);
--> statement-breakpoint
ALTER TABLE "smart_scope_kobo_subscriptions" ADD CONSTRAINT "smart_scope_kobo_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "smart_scope_kobo_subscriptions" ADD CONSTRAINT "smart_scope_kobo_subscriptions_smart_scope_id_smart_scopes_id_fk" FOREIGN KEY ("smart_scope_id") REFERENCES "public"."smart_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "smart_scope_kobo_subscriptions_smart_scope_id_idx" ON "smart_scope_kobo_subscriptions" USING btree ("smart_scope_id");