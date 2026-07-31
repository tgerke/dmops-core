import type { QueryRow } from "@dmops/adapter-contract";
import {
  type ComputeContext,
  type ComputeFn,
  type SnapshotValue,
  businessDaysBetween,
  daysBetween,
  inPeriod,
  median,
} from "../types.js";

/**
 * query_tat_median: median elapsed days from issuance to closure, across
 * queries closed within the reporting period. Cancelled queries are
 * excluded. Grains: study, site. The day-counting rule is the versioned
 * difference: v1.0 calendar days, v1.1 weekday-only business days, v1.2
 * business days minus the study's holiday calendar (ADR-0004, ADR-0016).
 */
const makeQueryTatMedian =
  (elapsedFor: (ctx: ComputeContext) => (start: string, end: string) => number): ComputeFn =>
  (frames, ctx) => {
    const elapsed = elapsedFor(ctx);
    const closed = (frames.queries ?? []).filter(
      (q): q is QueryRow & { closed_at: string } =>
        q.status === "closed" &&
        q.closed_at !== null &&
        inPeriod(q.closed_at, ctx.periodStart, ctx.periodEnd),
    );
    const tat = (qs: typeof closed) => qs.map((q) => elapsed(q.opened_at, q.closed_at));

    const rows: SnapshotValue[] = [
      {
        grain: "study",
        site_key: null,
        value: median(tat(closed)),
        numerator: null,
        denominator: null,
        n_records: closed.length,
      },
    ];
    const siteKeys = [
      ...new Set(closed.map((q) => q.site_key).filter((s): s is string => s !== null)),
    ];
    for (const siteKey of siteKeys.sort()) {
      const siteQueries = closed.filter((q) => q.site_key === siteKey);
      rows.push({
        grain: "site",
        site_key: siteKey,
        value: median(tat(siteQueries)),
        numerator: null,
        denominator: null,
        n_records: siteQueries.length,
      });
    }
    return rows;
  };

/** v1.0 (calendar days): deregistered from the engine but kept to pin historical snapshots (DM-Q1). */
export const queryTatMedian: ComputeFn = makeQueryTatMedian(() => daysBetween);

/** v1.1 (business days, Mon–Fri UTC, no holidays): deregistered but pinned (DM-Q5). */
export const queryTatMedianV1_1: ComputeFn = makeQueryTatMedian(() => businessDaysBetween);

/** v1.2 (business days minus the study's holiday calendar, ADR-0016): the engine-current version (DM-Q5). */
export const queryTatMedianV1_2: ComputeFn = makeQueryTatMedian(
  (ctx) => (start, end) => businessDaysBetween(start, end, ctx.holidays),
);
