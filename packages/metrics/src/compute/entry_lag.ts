import {
  type ComputeContext,
  type ComputeFn,
  businessDaysBetween,
  daysBetween,
  inPeriod,
  median,
} from "../types.js";

/**
 * entry_lag: median elapsed days from visit date to first data entry of the
 * visit's pages, across pages first entered within the reporting period.
 * Pages whose visit has no recorded date are excluded. Grain: study. The
 * day-counting rule is the versioned difference: v1.0 calendar days, v1.1
 * weekday-only business days, v1.2 business days minus the study's holiday
 * calendar (ADR-0004, ADR-0016).
 */
const makeEntryLag =
  (elapsedFor: (ctx: ComputeContext) => (start: string, end: string) => number): ComputeFn =>
  (frames, ctx) => {
    const elapsed = elapsedFor(ctx);
    const visitDates = new Map<string, string>();
    for (const v of frames.visits ?? []) {
      if (v.visit_date !== null && v.occurred) {
        visitDates.set(`${v.subject_key} ${v.visit_key}`, v.visit_date);
      }
    }
    const lags: number[] = [];
    for (const p of frames.pages ?? []) {
      if (p.first_entered_at === null || p.visit_key === null) continue;
      if (!inPeriod(p.first_entered_at, ctx.periodStart, ctx.periodEnd)) continue;
      const visitDate = visitDates.get(`${p.subject_key} ${p.visit_key}`);
      if (!visitDate) continue;
      lags.push(elapsed(visitDate, p.first_entered_at));
    }
    return [
      {
        grain: "study",
        site_key: null,
        value: median(lags),
        numerator: null,
        denominator: null,
        n_records: lags.length,
      },
    ];
  };

/** v1.0 (calendar days): deregistered from the engine but kept to pin historical snapshots (DM-Q3). */
export const entryLag: ComputeFn = makeEntryLag(() => daysBetween);

/** v1.1 (business days, Mon–Fri UTC, no holidays): deregistered but pinned (DM-Q6). */
export const entryLagV1_1: ComputeFn = makeEntryLag(() => businessDaysBetween);

/** v1.2 (business days minus the study's holiday calendar, ADR-0016): the engine-current version (DM-Q6). */
export const entryLagV1_2: ComputeFn = makeEntryLag(
  (ctx) => (start, end) => businessDaysBetween(start, end, ctx.holidays),
);
