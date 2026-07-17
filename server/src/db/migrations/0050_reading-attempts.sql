CREATE TABLE "reading_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"started_on" date,
	"ended_on" date,
	"outcome" varchar(20),
	"origin" varchar(20) NOT NULL,
	"external_provider" varchar(40),
	"external_id" varchar(255),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_attempts_outcome_chk" CHECK ("reading_attempts"."outcome" is null or "reading_attempts"."outcome" in ('completed', 'skimmed', 'abandoned')),
	CONSTRAINT "reading_attempts_origin_chk" CHECK ("reading_attempts"."origin" in ('manual', 'bookorbit', 'kobo', 'koreader', 'hardcover', 'migration')),
	CONSTRAINT "reading_attempts_end_after_start_chk" CHECK ("reading_attempts"."ended_on" is null or "reading_attempts"."started_on" is null or "reading_attempts"."ended_on" >= "reading_attempts"."started_on"),
	CONSTRAINT "reading_attempts_closed_has_outcome_chk" CHECK ("reading_attempts"."ended_on" is null or "reading_attempts"."outcome" is not null)
);
--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "attempt_id" integer;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD CONSTRAINT "reading_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_attempts" ADD CONSTRAINT "reading_attempts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reading_attempts_user_book_idx" ON "reading_attempts" USING btree ("user_id","book_id","id");--> statement-breakpoint
CREATE INDEX "reading_attempts_user_outcome_ended_idx" ON "reading_attempts" USING btree ("user_id","outcome","ended_on");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_attempts_one_active_uidx" ON "reading_attempts" USING btree ("user_id","book_id") WHERE "reading_attempts"."outcome" is null and "reading_attempts"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "reading_attempts_external_uidx" ON "reading_attempts" USING btree ("user_id","external_provider","external_id") WHERE "reading_attempts"."external_provider" is not null and "reading_attempts"."external_id" is not null;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_attempt_id_reading_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."reading_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rs_attempt_started_at_idx" ON "reading_sessions" USING btree ("attempt_id","started_at");