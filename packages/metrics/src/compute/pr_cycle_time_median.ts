import type { PullRequestRow } from "@dmops/adapter-contract";
import {
  type ComputeContext,
  type ComputeFn,
  type SnapshotValue,
  businessDaysBetween,
  inPeriod,
  median,
} from "../types.js";

/**
 * pr_cycle_time_median (DS starter set, ADR-0012): median business days
 * from pull request opened to merged, across pull requests merged in the
 * period. Closed-without-merge never enters. Grain: study only. The
 * day-counting rule is the versioned difference: v1.0 weekday-only, v1.1
 * business days minus the study's holiday calendar (ADR-0016).
 */
const makePrCycleTimeMedian =
  (elapsedFor: (ctx: ComputeContext) => (start: string, end: string) => number): ComputeFn =>
  (frames, ctx) => {
    const elapsed = elapsedFor(ctx);
    const merged = (frames.pull_requests ?? []).filter(
      (p): p is PullRequestRow & { merged_at: string } =>
        p.state === "merged" &&
        p.merged_at !== null &&
        inPeriod(p.merged_at, ctx.periodStart, ctx.periodEnd),
    );
    const cycles = merged.map((p) => elapsed(p.opened_at, p.merged_at));

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

/** v1.0 (business days, Mon–Fri UTC, no holidays): deregistered but pinned (DS-Q2). */
export const prCycleTimeMedian: ComputeFn = makePrCycleTimeMedian(() => businessDaysBetween);

/** v1.1 (business days minus the study's holiday calendar, ADR-0016): the engine-current version (DS-Q2). */
export const prCycleTimeMedianV1_1: ComputeFn = makePrCycleTimeMedian(
  (ctx) => (start, end) => businessDaysBetween(start, end, ctx.holidays),
);
