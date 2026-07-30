import { type ComputeFn, daysBetween, inPeriod, median } from "../types.js";

/**
 * milestone_slip v1.0: median calendar days between baseline and actual
 * completion, across milestones completed within the reporting period.
 * Positive = late. Source is dmops-core's own study_milestone facts
 * (ctx.milestones), not an adapter frame. Grain: study.
 */
export const milestoneSlip: ComputeFn = (_frames, ctx) => {
  const slips: number[] = [];
  for (const m of ctx.milestones ?? []) {
    if (m.status === "na" || m.actual_date === null || m.baseline_date === null) continue;
    if (!inPeriod(m.actual_date, ctx.periodStart, ctx.periodEnd)) continue;
    slips.push(daysBetween(m.baseline_date, m.actual_date));
  }
  return [
    {
      grain: "study",
      site_key: null,
      value: median(slips),
      numerator: null,
      denominator: null,
      n_records: slips.length,
    },
  ];
};
