-- 0002_app_role: least-privilege runtime roles (ADR-0003; compliance doc
-- honest gap 2). dmops_app holds DML only: no TRUNCATE, no DDL, no trigger
-- disablement (requires table ownership, which stays with the migration
-- role). Dev-grade passwords; production rotates with ALTER ROLE.
DO $$ BEGIN
  CREATE ROLE dmops_app LOGIN PASSWORD 'dmops_app';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO dmops_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dmops_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dmops_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dmops_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dmops_app;--> statement-breakpoint
-- The audit trail is written only by the trigger, never by the role: with
-- SECURITY DEFINER the trigger function inserts as the table owner, and the
-- runtime role loses direct INSERT — it cannot fabricate audit events even
-- with a correctly recomputed hash chain.
ALTER FUNCTION dmops_audit() SECURITY DEFINER;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_event FROM dmops_app;--> statement-breakpoint
-- Belt and suspenders on the append-only warehouse (DM-P3): the triggers
-- forbid mutation for everyone; the runtime role additionally lacks the
-- privilege at the grant level.
REVOKE UPDATE, DELETE, TRUNCATE ON metric_snapshot, source_extract, metric_definition FROM dmops_app;--> statement-breakpoint
-- The health endpoint reports applied-migration count; the runtime role may
-- read the migration journal (drizzle schema), nothing more.
GRANT USAGE ON SCHEMA drizzle TO dmops_app;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO dmops_app;--> statement-breakpoint
-- Read-only role for downstream BI (integration surface: metric snapshots
-- and derived views, nothing writable).
DO $$ BEGIN
  CREATE ROLE dmops_readonly LOGIN PASSWORD 'dmops_readonly';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO dmops_readonly;--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dmops_readonly;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO dmops_readonly;
