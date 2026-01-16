ALTER TABLE "scan_jobs" DROP CONSTRAINT "scan_jobs_library_id_libraries_id_fk";
--> statement-breakpoint
ALTER TABLE "scan_jobs" ADD CONSTRAINT "scan_jobs_library_id_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."libraries"("id") ON DELETE cascade ON UPDATE no action;