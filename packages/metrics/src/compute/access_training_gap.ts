import type { TrainingRecordRow } from "@dmops/adapter-contract";
import type { ComputeFn, SnapshotValue } from "../types.js";
import { currentAtPeriodEnd, requiredByPeriodEnd } from "./training_current_pct.js";

/**
 * access_training_gap v1.0/v2.0 (ADR-0013, ADR-0019): count of persons with
 * an active access grant at period end whose training shows a gap — a
 * required assignment not current, or no training on file at all. The same
 * predicate v_study_access_roster flags live; this is its immutable monthly
 * snapshot. Grain: study only. v2.0 changed only where the frames come from
 * (the mirror tables, assembled by the pipeline); the math is identical, so
 * one function carries both versions' DM-Q8 pins.
 */
export const accessTrainingGap: ComputeFn = (frames, ctx) => {
  // Inclusive of grants made any time on the period-end day.
  const endExclusive = Date.parse(ctx.periodEnd) + 86_400_000;
  const holders = new Set(
    (frames.access_grants ?? [])
      .filter(
        (g) =>
          g.status === "active" &&
          (g.granted_at === null || Date.parse(g.granted_at) < endExclusive),
      )
      .map((g) => g.person_key),
  );

  const byPerson = new Map<string, TrainingRecordRow[]>();
  for (const t of frames.training_records ?? []) {
    byPerson.set(t.person_key, [...(byPerson.get(t.person_key) ?? []), t]);
  }

  const gaps = [...holders].filter((person) => {
    const records = byPerson.get(person);
    if (!records || records.length === 0) return true; // access with no training on file
    return records.some(
      (t) => requiredByPeriodEnd(t, ctx.periodEnd) && !currentAtPeriodEnd(t, ctx.periodEnd),
    );
  });

  const row: SnapshotValue = {
    grain: "study",
    site_key: null,
    value: gaps.length,
    numerator: gaps.length,
    denominator: holders.size,
    n_records: holders.size,
  };
  return [row];
};
