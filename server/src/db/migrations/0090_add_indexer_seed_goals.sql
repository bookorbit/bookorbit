ALTER TABLE "request_indexers" ADD COLUMN "apply_tracker_seed_goals" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "request_indexers" ADD COLUMN "seed_ratio_goal" double precision;--> statement-breakpoint
ALTER TABLE "request_indexers" ADD COLUMN "seed_time_minutes" integer;--> statement-breakpoint
ALTER TABLE "request_indexers" ADD CONSTRAINT "request_indexers_seed_ratio_goal_chk" CHECK ("request_indexers"."seed_ratio_goal" is null or ("request_indexers"."seed_ratio_goal" > 0 and "request_indexers"."seed_ratio_goal" < 'Infinity'::double precision));--> statement-breakpoint
ALTER TABLE "request_indexers" ADD CONSTRAINT "request_indexers_seed_time_minutes_chk" CHECK ("request_indexers"."seed_time_minutes" is null or "request_indexers"."seed_time_minutes" > 0);