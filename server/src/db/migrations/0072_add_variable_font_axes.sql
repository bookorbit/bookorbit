ALTER TABLE "server_fonts" ADD COLUMN "weight_min" integer;--> statement-breakpoint
ALTER TABLE "server_fonts" ADD COLUMN "weight_max" integer;--> statement-breakpoint
ALTER TABLE "server_fonts" ADD COLUMN "instances" jsonb;--> statement-breakpoint
ALTER TABLE "user_fonts" ADD COLUMN "weight_min" integer;--> statement-breakpoint
ALTER TABLE "user_fonts" ADD COLUMN "weight_max" integer;--> statement-breakpoint
ALTER TABLE "user_fonts" ADD COLUMN "instances" jsonb;--> statement-breakpoint
ALTER TABLE "server_fonts" ADD CONSTRAINT "server_fonts_weight_range_chk" CHECK (("server_fonts"."weight_min" is null) = ("server_fonts"."weight_max" is null) and ("server_fonts"."weight_min" is null or ("server_fonts"."weight_min" >= 1 and "server_fonts"."weight_max" <= 1000 and "server_fonts"."weight_min" < "server_fonts"."weight_max")));--> statement-breakpoint
ALTER TABLE "user_fonts" ADD CONSTRAINT "user_fonts_weight_range_chk" CHECK (("user_fonts"."weight_min" is null) = ("user_fonts"."weight_max" is null) and ("user_fonts"."weight_min" is null or ("user_fonts"."weight_min" >= 1 and "user_fonts"."weight_max" <= 1000 and "user_fonts"."weight_min" < "user_fonts"."weight_max")));