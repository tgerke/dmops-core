import type { ReviewRow } from "@dmops/adapter-contract";
import {
  type ComputeFn,
  type SnapshotValue,
  businessDaysBetween,
  inPeriod,
  median,
} from "../types.js";

/**
 * pr_review_tat_median v1.0 (DS starter set, ADR-0012): median business days
 * from pull request opened to its earliest submitted review, across pull
 * requests whose earliest review landed in the period. Grain: study only —
 * site and country are EDC concepts with no meaning for repository work.
 */
export const prReviewTatMedian: ComputeFn = (frames, ctx) => {
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
    tats.push(businessDaysBetween(pr.opened_at, first.submitted_at));
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
