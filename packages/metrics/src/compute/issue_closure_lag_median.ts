import type { IssueRow } from "@dmops/adapter-contract";
import { type ComputeFn, type SnapshotValue, daysBetween, inPeriod, median } from "../types.js";

/**
 * issue_closure_lag_median v1.0 (DS starter set, ADR-0012): median calendar
 * days from issue opened to closed, across issues closed in the period.
 * Grain: study only.
 */
export const issueClosureLagMedian: ComputeFn = (frames, ctx) => {
  const closed = (frames.issues ?? []).filter(
    (i): i is IssueRow & { closed_at: string } =>
      i.state === "closed" &&
      i.closed_at !== null &&
      inPeriod(i.closed_at, ctx.periodStart, ctx.periodEnd),
  );
  const lags = closed.map((i) => daysBetween(i.opened_at, i.closed_at));

  const row: SnapshotValue = {
    grain: "study",
    site_key: null,
    value: median(lags),
    numerator: null,
    denominator: null,
    n_records: closed.length,
  };
  return [row];
};
