CREATE INDEX "idx_audit_actor_username" ON "audit_log" USING btree ("actor_username");--> statement-breakpoint
CREATE INDEX "idx_audit_actor_username_trgm" ON "audit_log" USING gin ("actor_username" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_resource_id" ON "audit_log" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_resource_trgm" ON "audit_log" USING gin ("resource" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_action_trgm" ON "audit_log" USING gin ("action" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_description_trgm" ON "audit_log" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_meta_text_trgm" ON "audit_log" USING gin (("meta"::text) gin_trgm_ops);