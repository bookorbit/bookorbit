CREATE TABLE "story_edits" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"data" jsonb NOT NULL,
	"position" double precision,
	"client_updated_at" timestamp with time zone NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"revision" bigserial NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_edits_user_id_book_id_id_pk" PRIMARY KEY("user_id","book_id","id"),
	CONSTRAINT "story_edits_kind_not_empty_chk" CHECK (char_length("story_edits"."kind") >= 1),
	CONSTRAINT "story_edits_data_object_chk" CHECK (jsonb_typeof("story_edits"."data") = 'object'),
	CONSTRAINT "story_edits_position_range_chk" CHECK ("story_edits"."position" is null or ("story_edits"."position" >= 0 and "story_edits"."position" <= 1))
);
--> statement-breakpoint
ALTER TABLE "story_edits" ADD CONSTRAINT "story_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_edits" ADD CONSTRAINT "story_edits_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_edits_user_book_revision_idx" ON "story_edits" USING btree ("user_id","book_id","revision");--> statement-breakpoint
CREATE INDEX "story_edits_book_id_idx" ON "story_edits" USING btree ("book_id");