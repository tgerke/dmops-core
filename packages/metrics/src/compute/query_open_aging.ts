import type { QueryRow } from "@dmops/adapter-contract";
import { type ComputeFn, type SnapshotValue, daysBetween } from "../types.js";

/**
 * query_open_aging v1.0: count of open/answered queries older than 30
 * calendar days as of period end; denominator = all open queries at period
 * end. Grains: study, site.
 */
export const queryOpenAging: ComputeFn = (frames, ctx) => {
  const open = (frames.queries ?? []).filter(
    (q) =>
      (q.status === "open" || q.status === "answered") &&
      Date.parse(q.opened_at) <= Date.parse(ctx.periodEnd) + 86_400_000,
  );
  const aged = (qs: QueryRow[]) => qs.filter((q) => daysBetween(q.opened_at, ctx.periodEnd) > 30);

  const agedOpen = aged(open);
  const rows: SnapshotValue[] = [
    {
      grain: "study",
      site_key: null,
      value: agedOpen.length,
      numerator: agedOpen.length,
      denominator: open.length,
      n_records: open.length,
    },
  ];
  const siteKeys = [...new Set(open.map((q) => q.site_key).filter((s): s is string => s !== null))];
  for (const siteKey of siteKeys.sort()) {
    const siteQueries = open.filter((q) => q.site_key === siteKey);
    rows.push({
      grain: "site",
      site_key: siteKey,
      value: aged(siteQueries).length,
      numerator: aged(siteQueries).length,
      denominator: siteQueries.length,
      n_records: siteQueries.length,
    });
  }
  return rows;
};
