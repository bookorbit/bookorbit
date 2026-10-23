-- An unreleased build created this table as migration 0109; keep its row and installation UUID.
CREATE TABLE IF NOT EXISTS "server_identity" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"instance_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	CONSTRAINT "server_identity_singleton" CHECK ("server_identity"."id" = 1)
);
