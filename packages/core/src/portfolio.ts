import type { Sql } from "@dmops/db";
import { assertRegistryMatchesSpecs, loadSpecs, poolingKind } from "@dmops/metrics";

/**
 * The portfolio roll-up (ADR-0015). Read-only by construction: every number
 * is an exact aggregate of stored study-grain snapshots (migrations/0008) or
 * of the lock-readiness views (ADR-0014). Pooling is exact or it does not
 * happen — medians and mixed metric versions serve the per-study spread
 * with a named reason, never a fake pooled value (ADR-0005).
 */

export interface PortfolioStudyCounts {
  total: number;
  by_status: Record<string, number>;
  stat_enabled: number;
}

export interface PortfolioStudyValue {
  study_id: string;
  protocol_number: string;
  metric_version: string;
  value: string | null;
  n_records: number | null;
  period_end: string;
}

export interface PortfolioMetric {
  metric_id: string;
  version: string;
  label: string;
  module: string;
  target: string | null;
  pooling: "sum" | "ratio" | "median";
  studies_in_scope: number;
  studies_reporting: number;
  poolable: boolean;
  not_pooled_reason: string | null;
  pooled: { numerator: number; denominator: number; pct: string | null } | null;
  min_value: string | null;
  max_value: string | null;
  /** The spread display behind a metric that does not pool. */
  per_study: PortfolioStudyValue[];
  earliest_period_end: string | null;
  latest_period_end: string | null;
}

export interface PortfolioLockStudyRow {
  study_id: string;
  protocol_number: string;
  readiness_pct: string | null;
  gates_satisfied: number;
  gates_applicable: number;
  gates_blocked: number;
  next_gate_code: string | null;
  next_gate_label: string | null;
  lock_planned_date: string | null;
  lock_forecast_date: string | null;
  lock_actual_date: string | null;
}

export interface PortfolioLockTrendPoint {
  period_start: string;
  period_end: string;
  studies_reporting: number;
  gates_satisfied: number;
  gates_applicable: number;
  readiness_pct: string | null;
}

export interface PortfolioLock {
  studies: number;
  gates_applicable: number;
  gates_satisfied: number;
  readiness_pct: string | null;
  studies_with_blocked_gates: number;
  studies_locked: number;
  per_study: PortfolioLockStudyRow[];
  trend: PortfolioLockTrendPoint[];
}

export interface Portfolio {
  studies: PortfolioStudyCounts;
  metrics: PortfolioMetric[];
  lock: PortfolioLock;
}

interface RollupRow {
  metric_id: string;
  studies_reporting: number;
  versions_reporting: number;
  latest_version: string;
  earliest_period_end: string | null;
  latest_period_end: string | null;
  poolable: boolean;
  pooled_numerator: string | null;
  pooled_denominator: string | null;
  pooled_pct: string | null;
  total_records: number | null;
  min_value: string | null;
  max_value: string | null;
}

export async function portfolioRollup(sql: Sql): Promise<Portfolio> {
  const [counts] = await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE 'dm' = ANY (modules))::int AS dm_enabled,
      count(*) FILTER (WHERE 'stat' = ANY (modules))::int AS stat_enabled
    FROM study`;
  const statusRows = await sql`
    SELECT status, count(*)::int AS n FROM study GROUP BY status ORDER BY status`;
  const inScopeByModule: Record<string, number> = {
    dm: Number(counts?.dm_enabled ?? 0),
    stat: Number(counts?.stat_enabled ?? 0),
  };

  const rollupRows = (await sql`
    SELECT * FROM v_portfolio_metric_rollup`) as unknown as RollupRow[];
  const rollupByMetric = new Map(rollupRows.map((r) => [r.metric_id, r]));
  const spreadRows = (await sql`
    SELECT metric_id, metric_version, study_id, protocol_number, value,
           n_records, period_end
    FROM v_portfolio_metric_study
    ORDER BY metric_id, protocol_number`) as unknown as (PortfolioStudyValue & {
    metric_id: string;
  })[];

  // Metrics for a module no study has enabled are out of scope, not shown
  // empty: the module boundary hides them entirely (ADR-0011).
  const specs = assertRegistryMatchesSpecs(loadSpecs())
    .filter(({ spec }) => (inScopeByModule[spec.module] ?? 0) > 0)
    .sort((a, b) =>
      a.spec.module === b.spec.module
        ? a.spec.id.localeCompare(b.spec.id)
        : a.spec.module.localeCompare(b.spec.module),
    );

  const metrics: PortfolioMetric[] = specs.map(({ spec }) => {
    const kind = poolingKind(spec.id);
    const rollup = rollupByMetric.get(spec.id);
    const poolable = Boolean(rollup?.poolable) && kind !== "median";
    let reason: string | null = null;
    if (kind === "median") {
      reason = "median metrics cannot be pooled from per-study medians";
    } else if (rollup && Number(rollup.versions_reporting) > 1) {
      reason = "metric versions differ across studies";
    } else if (rollup && !rollup.poolable) {
      reason = "a reporting study's snapshot lacks the ratio parts";
    }
    return {
      metric_id: spec.id,
      version: spec.version,
      label: spec.label,
      module: spec.module,
      target: spec.target ?? null,
      pooling: kind,
      studies_in_scope: inScopeByModule[spec.module] ?? 0,
      studies_reporting: Number(rollup?.studies_reporting ?? 0),
      poolable,
      not_pooled_reason: reason,
      pooled:
        poolable && rollup
          ? {
              numerator: Number(rollup.pooled_numerator),
              denominator: Number(rollup.pooled_denominator),
              pct: rollup.pooled_pct,
            }
          : null,
      min_value: rollup?.min_value ?? null,
      max_value: rollup?.max_value ?? null,
      per_study: poolable
        ? []
        : spreadRows
            .filter((r) => r.metric_id === spec.id)
            .map(({ study_id, protocol_number, metric_version, value, n_records, period_end }) => ({
              study_id,
              protocol_number,
              metric_version,
              value,
              n_records,
              period_end,
            })),
      earliest_period_end: rollup?.earliest_period_end ?? null,
      latest_period_end: rollup?.latest_period_end ?? null,
    };
  });

  const [lockSummary] = await sql`SELECT * FROM v_portfolio_lock_readiness`;
  const lockStudies = (await sql`
    SELECT r.study_id, st.protocol_number, r.readiness_pct, r.gates_satisfied,
           r.gates_applicable, r.gates_blocked, r.next_gate_code,
           r.next_gate_label, r.lock_planned_date, r.lock_forecast_date,
           r.lock_actual_date
    FROM v_study_lock_readiness r
    JOIN study st ON st.id = r.study_id
    ORDER BY r.readiness_pct NULLS LAST, st.protocol_number`) as unknown as PortfolioLockStudyRow[];
  const trend = (await sql`
    SELECT * FROM v_portfolio_lock_trend
    ORDER BY period_start`) as unknown as PortfolioLockTrendPoint[];

  return {
    studies: {
      total: Number(counts?.total ?? 0),
      by_status: Object.fromEntries(statusRows.map((r) => [r.status as string, Number(r.n)])),
      stat_enabled: Number(counts?.stat_enabled ?? 0),
    },
    metrics,
    lock: {
      studies: Number(lockSummary?.studies ?? 0),
      gates_applicable: Number(lockSummary?.gates_applicable ?? 0),
      gates_satisfied: Number(lockSummary?.gates_satisfied ?? 0),
      readiness_pct: (lockSummary?.readiness_pct as string | null) ?? null,
      studies_with_blocked_gates: Number(lockSummary?.studies_with_blocked_gates ?? 0),
      studies_locked: Number(lockSummary?.studies_locked ?? 0),
      per_study: lockStudies,
      trend,
    },
  };
}
