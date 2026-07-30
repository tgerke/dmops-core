import { type ComputeFn, type SnapshotValue, daysBetween } from "../types.js";

/**
 * issue_open_aging v1.0 (DS starter set, ADR-0012): count of open issues
 * older than 30 calendar days as of period end; denominator = all open
 * issues at period end. The query_open_aging pattern applied to repository
 * work. Grain: study only.
 */
export const issueOpenAging: ComputeFn = (frames, ctx) => {
  const open = (frames.issues ?? []).filter(
    (i) => i.state === "open" && Date.parse(i.opened_at) <= Date.parse(ctx.periodEnd) + 86_400_000,
  );
  const aged = open.filter((i) => daysBetween(i.opened_at, ctx.periodEnd) > 30);

  const row: SnapshotValue = {
    grain: "study",
    site_key: null,
    value: aged.length,
    numerator: aged.length,
    denominator: open.length,
    n_records: open.length,
  };
  return [row];
};
