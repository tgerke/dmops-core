-- 0008_portfolio_rollup: the portfolio as derived views (ADR-0015).
-- Every number is an exact aggregate of stored study-grain snapshot rows
-- (ADR-0007) or of the lock-readiness views (ADR-0014) — no table, no
-- write path, no portfolio-grain compute. Medians and mixed definition
-- versions fail closed (poolable = false): a pooled value the parts cannot
-- support is never served (ADR-0005, DM-P2, DM-P3).
CREATE VIEW v_portfolio_metric_rollup AS
WITH latest AS (
  SELECT * FROM v_metric_latest WHERE grain = 'study'
),
agg AS (
  SELECT
    metric_id,
    count(*)::int AS studies_reporting,
    count(DISTINCT metric_version)::int AS versions_reporting,
    max(metric_version) AS latest_version,
    min(period_end) AS earliest_period_end,
    max(period_end) AS latest_period_end,
    -- Poolable iff one definition version and every latest row carries the
    -- ratio parts; median computes store null numerator/denominator by
    -- construction, so a median can never sneak into a pool.
    (count(DISTINCT metric_version) = 1
      AND count(numerator) = count(*)
      AND count(denominator) = count(*)) AS poolable,
    sum(numerator) AS sum_numerator,
    sum(denominator) AS sum_denominator,
    sum(n_records)::int AS total_records,
    min(value) AS min_value,
    max(value) AS max_value
  FROM latest
  GROUP BY metric_id
)
SELECT
  metric_id,
  studies_reporting,
  versions_reporting,
  latest_version,
  earliest_period_end,
  latest_period_end,
  poolable,
  CASE WHEN poolable THEN sum_numerator END AS pooled_numerator,
  CASE WHEN poolable THEN sum_denominator END AS pooled_denominator,
  CASE WHEN poolable AND sum_denominator > 0
    THEN round(100.0 * sum_numerator / sum_denominator, 1)
  END AS pooled_pct,
  total_records,
  min_value,
  max_value
FROM agg;
--> statement-breakpoint
-- The per-study latest values behind each roll-up row: the spread display
-- served when pooling is not honest — the alternative to a fake portfolio
-- median (ADR-0005 applied to aggregation).
CREATE VIEW v_portfolio_metric_study AS
SELECT
  v.metric_id,
  v.metric_version,
  v.study_id,
  st.protocol_number,
  v.value,
  v.numerator,
  v.denominator,
  v.n_records,
  v.period_start,
  v.period_end,
  v.computed_at
FROM v_metric_latest v
JOIN study st ON st.id = v.study_id
WHERE v.grain = 'study';
--> statement-breakpoint
-- "Now" across the portfolio: gate counts summed over the live derived
-- scores. Integer counts, so the pooling is exact by construction
-- (ADR-0014).
CREATE VIEW v_portfolio_lock_readiness AS
SELECT
  count(*)::int AS studies,
  sum(gates_applicable)::int AS gates_applicable,
  sum(gates_satisfied)::int AS gates_satisfied,
  count(*) FILTER (WHERE gates_blocked > 0)::int AS studies_with_blocked_gates,
  count(*) FILTER (WHERE lock_actual_date IS NOT NULL)::int AS studies_locked,
  CASE WHEN sum(gates_applicable) > 0
    THEN round(100.0 * sum(gates_satisfied) / sum(gates_applicable), 1)
  END AS readiness_pct
FROM v_study_lock_readiness;
--> statement-breakpoint
-- The burn-up ADR-0014 wrote the monthly snapshots for: one point per
-- reporting period, latest compute per (study, period) — a period can be
-- recomputed; computed_at breaks the tie — with gate counts pooled across
-- the studies that reported it. History reads as reported then (DM-P3).
CREATE VIEW v_portfolio_lock_trend AS
WITH latest_per_period AS (
  SELECT DISTINCT ON (study_id, period_start) *
  FROM metric_snapshot
  WHERE metric_id = 'lock_readiness_pct' AND grain = 'study'
  ORDER BY study_id, period_start, computed_at DESC
)
SELECT
  period_start,
  period_end,
  count(*)::int AS studies_reporting,
  sum(numerator)::int AS gates_satisfied,
  sum(denominator)::int AS gates_applicable,
  CASE WHEN sum(denominator) > 0
    THEN round(100.0 * sum(numerator) / sum(denominator), 1)
  END AS readiness_pct
FROM latest_per_period
GROUP BY period_start, period_end;
