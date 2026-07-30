-- 0003_milestone_rebaseline: governed re-baselining (ADR-0009, exercising the
-- deferral in ADR-0008). Corrections are new rows: each re-baseline appends an
-- immutable, audited record; study_milestone.planned_date is the projection.
CREATE TABLE "milestone_rebaseline" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "study_milestone_id" uuid NOT NULL REFERENCES "study_milestone"("id"),
  "rebaseline_number" integer NOT NULL,
  "previous_planned_date" date,
  "new_planned_date" date NOT NULL,
  "reason" text NOT NULL,
  "reference_uri" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "milestone_rebaseline_reason_nonempty" CHECK (length(trim(reason)) >= 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_rebaseline_seq_idx"
  ON "milestone_rebaseline" ("study_milestone_id", "rebaseline_number");
--> statement-breakpoint
-- Append-only for every role: a re-baseline is history (DM-P3 pattern).
CREATE TRIGGER milestone_rebaseline_immutable BEFORE UPDATE OR DELETE ON milestone_rebaseline
  FOR EACH ROW EXECUTE FUNCTION dmops_forbid_mutation();
--> statement-breakpoint
-- Governance actions are worth attributing; append-only, so only INSERT can
-- fire (same stance as metric_definition in 0001).
CREATE TRIGGER milestone_rebaseline_audit AFTER INSERT ON milestone_rebaseline
  FOR EACH ROW EXECUTE FUNCTION dmops_audit();
--> statement-breakpoint
-- 0002's ALTER DEFAULT PRIVILEGES already granted dmops_app full DML on new
-- tables; take back what an append-only table must not allow. Belt and
-- suspenders — the trigger forbids mutation for everyone (ADR-0003).
REVOKE UPDATE, DELETE, TRUNCATE ON milestone_rebaseline FROM dmops_app;
--> statement-breakpoint
-- Board view grows rebaseline lineage (columns appended at the end, so
-- CREATE OR REPLACE is legal).
CREATE OR REPLACE VIEW v_study_milestone_board AS
SELECT
  sm.id,
  sm.study_id,
  sm.code,
  sm.occurrence,
  md.label,
  md.phase_group,
  md.sequence,
  md.is_repeating,
  sm.baseline_date,
  sm.planned_date,
  sm.forecast_date,
  sm.actual_date,
  sm.status,
  sm.owner_id,
  p.name AS owner_name,
  sm.blocker_note,
  sm.evidence_uri,
  sm.updated_at,
  -- Slip vs plan while in flight; slip vs baseline once actual lands.
  (sm.forecast_date - sm.planned_date) AS forecast_slip_days,
  (sm.actual_date - sm.baseline_date) AS actual_slip_days,
  coalesce(rb.n, 0) AS rebaseline_count,
  rb.last_rebaselined_at
FROM study_milestone sm
JOIN milestone_definition md ON md.code = sm.code
LEFT JOIN person p ON p.id = sm.owner_id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS n, max(created_at) AS last_rebaselined_at
  FROM milestone_rebaseline WHERE study_milestone_id = sm.id
) rb ON true;
