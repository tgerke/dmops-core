-- 0005_stat_module: discipline modules (ADR-0011). Taxonomy codes carry a
-- module tag; a study opts into modules as an audited column on its own row
-- (no new table — enabling a module is one attributed study UPDATE). Module
-- filtering lives in the views, so every read of the board or the summary is
-- filtered in exactly one place; a deployment that never enables 'stat' sees
-- the slice-3 product unchanged.
ALTER TYPE "phase_group" ADD VALUE 'analysis';
--> statement-breakpoint
CREATE TYPE "module" AS ENUM ('dm', 'stat');
--> statement-breakpoint
ALTER TABLE "milestone_definition" ADD COLUMN "module" "module" DEFAULT 'dm' NOT NULL;
--> statement-breakpoint
-- 'dm' is the base product, not an option: every study carries it (ADR-0011).
ALTER TABLE "study" ADD COLUMN "modules" "module"[] DEFAULT '{dm}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "study" ADD CONSTRAINT "study_modules_dm_baseline" CHECK ('dm' = ANY (modules));
--> statement-breakpoint
-- Board rows exist only for the study's enabled modules (same columns, so
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
JOIN study st ON st.id = sm.study_id AND md.module = ANY (st.modules)
LEFT JOIN person p ON p.id = sm.owner_id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS n, max(created_at) AS last_rebaselined_at
  FROM milestone_rebaseline WHERE study_milestone_id = sm.id
) rb ON true;
--> statement-breakpoint
-- Summary counts re-derive from the board view so the module filter cannot
-- drift between the two.
CREATE OR REPLACE VIEW v_study_summary AS
SELECT
  s.id AS study_id,
  s.protocol_number,
  s.short_title,
  s.phase,
  s.indication,
  s.status AS study_status,
  sp.name AS sponsor_name,
  lead.name AS dm_lead_name,
  count(b.id) AS milestone_total,
  count(*) FILTER (WHERE b.status = 'complete') AS milestone_complete,
  count(*) FILTER (WHERE b.status = 'blocked') AS milestone_blocked,
  count(*) FILTER (WHERE b.status = 'in_progress') AS milestone_in_progress,
  count(*) FILTER (WHERE b.status = 'na') AS milestone_na,
  CASE WHEN count(*) FILTER (WHERE b.status <> 'na') > 0
    THEN round(100.0 * count(*) FILTER (WHERE b.status = 'complete')
      / count(*) FILTER (WHERE b.status <> 'na'), 1)
  END AS pct_complete,
  next_ms.code AS next_milestone_code,
  next_ms.label AS next_milestone_label,
  next_ms.planned_date AS next_milestone_planned
FROM study s
LEFT JOIN sponsor sp ON sp.id = s.sponsor_id
LEFT JOIN person lead ON lead.id = s.dm_lead_id
LEFT JOIN v_study_milestone_board b ON b.study_id = s.id
LEFT JOIN LATERAL (
  SELECT b2.code, b2.label, b2.planned_date
  FROM v_study_milestone_board b2
  WHERE b2.study_id = s.id
    AND b2.status IN ('not_started', 'in_progress', 'blocked')
    AND b2.planned_date IS NOT NULL
  ORDER BY b2.planned_date ASC
  LIMIT 1
) next_ms ON true
GROUP BY s.id, sp.name, lead.name, next_ms.code, next_ms.label, next_ms.planned_date;
