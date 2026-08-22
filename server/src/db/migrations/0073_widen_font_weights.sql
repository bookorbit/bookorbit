ALTER TABLE "server_fonts" DROP CONSTRAINT "server_fonts_weight_chk";--> statement-breakpoint
ALTER TABLE "user_fonts" DROP CONSTRAINT "user_fonts_weight_chk";--> statement-breakpoint
ALTER TABLE "server_fonts" ADD CONSTRAINT "server_fonts_weight_chk" CHECK ("server_fonts"."weight" >= 1 and "server_fonts"."weight" <= 1000);--> statement-breakpoint
ALTER TABLE "user_fonts" ADD CONSTRAINT "user_fonts_weight_chk" CHECK ("user_fonts"."weight" >= 1 and "user_fonts"."weight" <= 1000);