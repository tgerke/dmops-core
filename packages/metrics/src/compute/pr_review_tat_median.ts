import type { ReviewRow } from "@dmops/adapter-contract";
import {
  type ComputeContext,
  type ComputeFn,
  type SnapshotValue,
  businessDaysBetween,
  inPeriod,
  median,
} from "../types.js";

/**
 * pr_review_tat_median (DS starter set, ADR-0012): median business days
 * from pull request opened to its earliest submitted review, across pull
 * requests whose earliest review landed in the period. Grain: study only —
 * site and country are EDC concepts with no meaning for repository work.
 * The day-counting rule is the versioned difference: v1.0 weekday-only,
 * v1.1 business days minus the study's holiday calendar (ADR-0016).
 */
const makePrReviewTatMedian =
  (elapsedFor: (ctx: ComputeContext) => (start: string, end: string) => number): ComputeFn =>
  (frames, ctx) => {
    const elapsed = elapsedFor(ctx);
    const earliestReview = new Map<string, ReviewRow>();
    for (const r of frames.reviews ?? []) {
      const key = `${r.repo_key}#${r.source_pr_id}`;
      const prior = earliestReview.get(key);
      if (!prior || Date.parse(r.submitted_at) < Date.parse(prior.submitted_at)) {
        earliestReview.set(key, r);
      }
    }

    const tats: number[] = [];
    for (const pr of frames.pull_requests ?? []) {
      const first = earliestReview.get(`${pr.repo_key}#${pr.source_pr_id}`);
      if (!first || !inPeriod(first.submitted_at, ctx.periodStart, ctx.periodEnd)) continue;
      tats.push(elapsed(pr.opened_at, first.submitted_at));
    }

    const row: SnapshotValue = {
      grain: "study",
      site_key: null,
      value: median(tats),
      numerator: null,
      denominator: null,
      n_records: tats.length,
    };
    return [row];
  };

/** v1.0 (business days, Mon–Fri UTC, no holidays): deregistered but pinned (DS-Q1). */
export const prReviewTatMedian: ComputeFn = makePrReviewTatMedian(() => businessDaysBetween);

/** v1.1 (business days minus the study's holiday calendar, ADR-0016): the engine-current version (DS-Q1). */
export const prReviewTatMedianV1_1: ComputeFn = makePrReviewTatMedian(
  (ctx) => (start, end) => businessDaysBetween(start, end, ctx.holidays),
);
