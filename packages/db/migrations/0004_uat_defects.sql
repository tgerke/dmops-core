-- 0004_uat_defects: UAT cycles and defects (ADR-0010). Operational status of
-- UAT, not the test evidence: script execution lives in the validated system
-- and the eTMF, mirrored here as counts plus a pointer (ADR-0006). Rows are
-- mutable audited workflow state (ADR-0003); endings are dated facts.
CREATE TYPE "uat_cycle_status" AS ENUM ('planned', 'in_progress', 'complete', 'cancelled');
--> statement-breakpoint
CREATE TYPE "uat_defect_status" AS ENUM ('open', 'resolved', 'closed', 'withdrawn');
--> statement-breakpoint
CREATE TYPE "uat_defect_severity" AS ENUM ('critical', 'major', 'minor');
--> statement-breakpoint
CREATE TABLE "uat_cycle" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_id" uuid NOT NULL REFERENCES "study"("id"),
  "cycle_number" integer NOT NULL,
  "title" text NOT NULL,
  "status" "uat_cycle_status" DEFAULT 'planned' NOT NULL,
  "started_date" date,
  "completed_date" date,
  "scripts_planned" integer,
  "scripts_executed" integer,
  "evidence_uri" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uat_cycle_complete_dated" CHECK (status <> 'complete' OR completed_date IS NOT NULL),
  CONSTRAINT "uat_cycle_scripts_sane" CHECK (
    scripts_executed IS NULL OR scripts_planned IS NULL OR scripts_executed <= scripts_planned
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uat_cycle_seq_idx" ON "uat_cycle" ("study_id", "cycle_number");
--> statement-breakpoint
CREATE TABLE "uat_defect" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cycle_id" uuid NOT NULL REFERENCES "uat_cycle"("id"),
  "defect_number" integer NOT NULL,
  "title" text NOT NULL,
  "severity" "uat_defect_severity" NOT NULL,
  "status" "uat_defect_status" DEFAULT 'open' NOT NULL,
  "raised_date" date NOT NULL,
  "resolved_date" date,
  "resolution_note" text,
  "reference_uri" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uat_defect_resolution_dated" CHECK (
    status NOT IN ('resolved', 'closed') OR resolved_date IS NOT NULL
  ),
  CONSTRAINT "uat_defect_closure_substantive" CHECK (
    status NOT IN ('closed', 'withdrawn') OR length(trim(coalesce(resolution_note, ''))) >= 10
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uat_defect_seq_idx" ON "uat_defect" ("cycle_id", "defect_number");
--> statement-breakpoint
-- Mutable workflow state: full DML auditing (deliverable stance, ADR-0003).
CREATE TRIGGER uat_cycle_audit AFTER INSERT OR UPDATE OR DELETE ON uat_cycle
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
CREATE TRIGGER uat_defect_audit AFTER INSERT OR UPDATE OR DELETE ON uat_defect
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
-- Defect counts are derived, never stored (columns enumerated, not uc.*, so
-- future additions can append and keep CREATE OR REPLACE legal).
CREATE VIEW v_uat_cycle AS
SELECT
  uc.id,
  uc.study_id,
  uc.cycle_number,
  uc.title,
  uc.status,
  uc.started_date,
  uc.completed_date,
  uc.scripts_planned,
  uc.scripts_executed,
  uc.evidence_uri,
  uc.updated_at,
  coalesce(d.open_defects, 0) AS open_defects,
  coalesce(d.resolved_defects, 0) AS resolved_defects,
  coalesce(d.closed_defects, 0) AS closed_defects,
  coalesce(d.withdrawn_defects, 0) AS withdrawn_defects,
  coalesce(d.total_defects, 0) AS total_defects
FROM uat_cycle uc
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE status = 'open')::int AS open_defects,
    count(*) FILTER (WHERE status = 'resolved')::int AS resolved_defects,
    count(*) FILTER (WHERE status = 'closed')::int AS closed_defects,
    count(*) FILTER (WHERE status = 'withdrawn')::int AS withdrawn_defects,
    count(*)::int AS total_defects
  FROM uat_defect WHERE cycle_id = uc.id
) d ON true;
