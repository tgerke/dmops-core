import type { PullRequestRow } from "@dmops/adapter-contract";
import {
  type ComputeFn,
  type SnapshotValue,
  businessDaysBetween,
  inPeriod,
  median,
} from "../types.js";

/**
 * pr_cycle_time_median v1.0 (DS starter set, ADR-0012): median business days
 * from pull request opened to merged, across pull requests merged in the
 * period. Closed-without-merge never enters. Grain: study only.
 */
export const prCycleTimeMedian: ComputeFn = (frames, ctx) => {
  const merged = (frames.pull_requests ?? []).filter(
    (p): p is PullRequestRow & { merged_at: string } =>
      p.state === "merged" &&
      p.merged_at !== null &&
      inPeriod(p.merged_at, ctx.periodStart, ctx.periodEnd),
  );
  const cycles = merged.map((p) => businessDaysBetween(p.opened_at, p.merged_at));

  const row: SnapshotValue = {
    grain: "study",
    site_key: null,
    value: median(cycles),
    numerator: null,
    denominator: null,
    n_records: merged.length,
  };
  return [row];
};
