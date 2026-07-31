-- 0007_lock_readiness: lock-readiness as a derived checklist (ADR-0014).
-- The gate set is the transitive depends_on closure of CLOSE.LOCK in the
-- governed taxonomy (ADR-0008) — no table, no configuration, no write path.
-- A readiness score that could be typed would be a second copy of the
-- milestone board (DM-P1); this one can only be moved by moving the
-- milestones themselves.
CREATE VIEW v_study_lock_gate AS
WITH RECURSIVE lock_dep AS (
  SELECT unnest(depends_on) AS code
  FROM milestone_definition WHERE code = 'CLOSE.LOCK'
  UNION
  SELECT unnest(md.depends_on)
  FROM milestone_definition md
  JOIN lock_dep d ON md.code = d.code
)
SELECT
  st.id AS study_id,
  md.code,
  md.label,
  md.phase_group,
  md.sequence,
  sm.occurrence,
  sm.status,
  sm.baseline_date,
  sm.planned_date,
  sm.forecast_date,
  sm.actual_date,
  sm.blocker_note,
  sm.evidence_uri,
  sm.owner_id,
  -- Satisfied is the leadership assertion on the board, nothing else; the
  -- summary view carries the system's own evidence beside it (ADR-0014).
  coalesce(sm.status = 'complete', false) AS satisfied,
  -- A gate with no instantiated milestone row is still asked: absence reads
  -- as "not done", never "not applicable".
  (sm.status IS NULL OR sm.status <> 'na') AS applicable
FROM study st
JOIN milestone_definition md
  ON md.code IN (SELECT code FROM lock_dep)
  AND md.active
  AND md.module = ANY (st.modules)
LEFT JOIN LATERAL (
  -- The closure holds no repeating codes today; latest occurrence if ever.
  SELECT * FROM study_milestone sm2
  WHERE sm2.study_id = st.id AND sm2.code = md.code
  ORDER BY sm2.occurrence DESC LIMIT 1
) sm ON true;
--> statement-breakpoint
-- One row per study: the score (unweighted — weights are dashboard
-- configuration, DM-P2), the next unmet gate, CLOSE.LOCK's own dates, and
-- the live signals. Signals never move the score; a missing signal source
-- is null with no as-of date, not zero (ADR-0005 fail-closed on display).
CREATE VIEW v_study_lock_readiness AS
SELECT
  st.id AS study_id,
  count(*) FILTER (WHERE g.applicable)::int AS gates_applicable,
  count(*) FILTER (WHERE g.applicable AND g.satisfied)::int AS gates_satisfied,
  count(*) FILTER (WHERE g.status = 'blocked')::int AS gates_blocked,
  CASE WHEN count(*) FILTER (WHERE g.applicable) > 0
    THEN round(100.0 * count(*) FILTER (WHERE g.applicable AND g.satisfied)
      / count(*) FILTER (WHERE g.applicable), 1)
  END AS readiness_pct,
  next_gate.code AS next_gate_code,
  next_gate.label AS next_gate_label,
  lock_ms.planned_date AS lock_planned_date,
  lock_ms.forecast_date AS lock_forecast_date,
  lock_ms.actual_date AS lock_actual_date,
  oq.open_queries,
  oq.open_queries_as_of,
  uat.open_cycles AS uat_open_cycles,
  uat.unresolved_defects AS uat_unresolved_defects,
  roster.training_gaps
FROM study st
LEFT JOIN v_study_lock_gate g ON g.study_id = st.id
LEFT JOIN LATERAL (
  SELECT g2.code, g2.label
  FROM v_study_lock_gate g2
  WHERE g2.study_id = st.id AND g2.applicable AND NOT g2.satisfied
  ORDER BY g2.sequence ASC LIMIT 1
) next_gate ON true
LEFT JOIN LATERAL (
  SELECT sm.planned_date, sm.forecast_date, sm.actual_date
  FROM study_milestone sm
  WHERE sm.study_id = st.id AND sm.code = 'CLOSE.LOCK'
  ORDER BY sm.occurrence DESC LIMIT 1
) lock_ms ON true
LEFT JOIN LATERAL (
  -- All open queries at the snapshot's period end (the metric's
  -- denominator), stamped with that period end: a snapshot is not "now".
  SELECT v.denominator::int AS open_queries, v.period_end AS open_queries_as_of
  FROM v_metric_latest v
  WHERE v.study_id = st.id AND v.metric_id = 'query_open_aging' AND v.grain = 'study'
  LIMIT 1
) oq ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE uc.status IN ('planned', 'in_progress'))::int AS open_cycles,
    coalesce(sum(uc.open_defects + uc.resolved_defects), 0)::int AS unresolved_defects
  FROM v_uat_cycle uc
  WHERE uc.study_id = st.id
) uat ON true
LEFT JOIN LATERAL (
  -- Empty roster means no access source is wired (replace-on-refresh), so
  -- the signal is a named absence, not zero. The UAT counts above are true
  -- zeros: those tables are dmops-owned facts.
  SELECT CASE WHEN count(*) = 0 THEN NULL
    ELSE count(*) FILTER (WHERE r.training_gap) END::int AS training_gaps
  FROM v_study_access_roster r
  WHERE r.study_id = st.id
) roster ON true
GROUP BY st.id, next_gate.code, next_gate.label,
  lock_ms.planned_date, lock_ms.forecast_date, lock_ms.actual_date,
  oq.open_queries, oq.open_queries_as_of,
  uat.open_cycles, uat.unresolved_defects, roster.training_gaps;
