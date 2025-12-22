-- Initial database setup
-- Migrations are handled by Drizzle Kit, this file is for any
-- Postgres extensions or initial configuration needed before migrations run.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for fuzzy text search
