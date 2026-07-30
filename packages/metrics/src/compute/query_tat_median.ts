import type { QueryRow } from "@dmops/adapter-contract";
import { type ComputeFn, type SnapshotValue, daysBetween, inPeriod, median } from "../types.js";

/**
 * query_tat_median v1.0: median calendar days from issuance to closure,
 * across queries closed within the reporting period. Cancelled queries are
 * excluded. Grains: study, site.
 */
export const queryTatMedian: ComputeFn = (frames, ctx) => {
  const closed = (frames.queries ?? []).filter(
    (q): q is QueryRow & { closed_at: string } =>
      q.status === "closed" &&
      q.closed_at !== null &&
      inPeriod(q.closed_at, ctx.periodStart, ctx.periodEnd),
  );
  const tat = (qs: typeof closed) => qs.map((q) => daysBetween(q.opened_at, q.closed_at));

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
