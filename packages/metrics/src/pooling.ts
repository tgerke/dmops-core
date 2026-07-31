export type PoolingKind = "sum" | "ratio" | "median";

/**
 * How each metric's portfolio number derives from its study parts
 * (ADR-0015). A closed enumeration in the registry's style (DM-P2): a new
 * metric must declare its portfolio behavior, and the coverage test fails
 * if the dictionary and this map ever disagree.
 *
 * "sum" — the value is a count; the portfolio value is sum(numerator),
 * with sum(denominator) beside it for context. "ratio" — the value is a
 * percent; the portfolio value is 100 * sum(numerator) / sum(denominator),
 * exact because snapshots store both parts (ADR-0007). "median" — never
 * pooled: a median of medians is not a median, so the portfolio serves the
 * per-study spread instead (ADR-0005 applied to aggregation).
 */
export const POOLING: Record<string, PoolingKind> = {
  query_tat_median: "median",
  query_open_aging: "sum",
  entry_lag: "median",
  milestone_slip: "median",
  // Lock-readiness (ADR-0014).
  lock_readiness_pct: "ratio",
  // Training and access mirrors (ADR-0013).
  training_current_pct: "ratio",
  access_training_gap: "sum",
  // DS starter set (ADR-0012), module: stat.
  pr_review_tat_median: "median",
  pr_cycle_time_median: "median",
  issue_closure_lag_median: "median",
  issue_open_aging: "sum",
};

export function poolingKind(metricId: string): PoolingKind {
  const kind = POOLING[metricId];
  if (!kind) throw new Error(`no pooling kind declared for metric ${metricId}`);
  return kind;
}
