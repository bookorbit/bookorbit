ALTER TABLE "audit_log" ADD COLUMN "resource_label" varchar(255);--> statement-breakpoint
CREATE INDEX "idx_audit_resource_label_trgm" ON "audit_log" USING gin ("resource_label" gin_trgm_ops);