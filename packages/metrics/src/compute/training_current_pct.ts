import type { TrainingRecordRow } from "@dmops/adapter-contract";
import type { ComputeFn, SnapshotValue } from "../types.js";

/** Required by period end: due on or before it, or undated (required now). */
export function requiredByPeriodEnd(t: TrainingRecordRow, periodEnd: string): boolean {
  return t.due_date === null || Date.parse(t.due_date) <= Date.parse(periodEnd);
}

/** Current as of period end: completed by it and unexpired strictly after it. */
export function currentAtPeriodEnd(t: TrainingRecordRow, periodEnd: string): boolean {
  const end = Date.parse(periodEnd);
  return (
    t.completed_date !== null &&
    Date.parse(t.completed_date) <= end &&
    (t.expires_date === null || Date.parse(t.expires_date) > end)
  );
}

/**
 * training_current_pct v1.0 (ADR-0013): of training assignments required by
 * period end, the percent current — completed and unexpired — as of period
 * end. Grain: study only.
 */
export const trainingCurrentPct: ComputeFn = (frames, ctx) => {
  const required = (frames.training_records ?? []).filter((t) =>
    requiredByPeriodEnd(t, ctx.periodEnd),
  );
  const current = required.filter((t) => currentAtPeriodEnd(t, ctx.periodEnd));

  const row: SnapshotValue = {
    grain: "study",
    site_key: null,
    value:
      required.length === 0 ? null : Math.round((1000 * current.length) / required.length) / 10,
    numerator: current.length,
    denominator: required.length,
    n_records: required.length,
  };
  return [row];
};
