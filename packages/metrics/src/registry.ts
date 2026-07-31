import { accessTrainingGap } from "./compute/access_training_gap.js";
import { entryLagV1_2 } from "./compute/entry_lag.js";
import { issueClosureLagMedian } from "./compute/issue_closure_lag_median.js";
import { issueOpenAging } from "./compute/issue_open_aging.js";
import { lockReadinessPct } from "./compute/lock_readiness_pct.js";
import { milestoneSlip } from "./compute/milestone_slip.js";
import { prCycleTimeMedianV1_1 } from "./compute/pr_cycle_time_median.js";
import { prReviewTatMedianV1_1 } from "./compute/pr_review_tat_median.js";
import { queryOpenAging } from "./compute/query_open_aging.js";
import { queryTatMedianV1_2 } from "./compute/query_tat_median.js";
import { trainingCurrentPct } from "./compute/training_current_pct.js";
import { type LoadedSpec, loadSpecs } from "./spec.js";
import type { ComputeFn } from "./types.js";

/**
 * The binding between the governed dictionary and versioned code (ADR-0004):
 * every (metric_id, version) in metrics/*.yaml must have exactly one compute
 * function here, and vice versa. assertRegistryMatchesSpecs() enforces the
 * bijection at startup — a YAML edit without a code change (or the reverse)
 * fails loudly instead of silently computing the wrong thing.
 */
const registry = new Map<string, ComputeFn>([
  // The elapsed-time metrics count holiday-aware business days (ADR-0016).
  ["query_tat_median@1.2", queryTatMedianV1_2],
  ["query_open_aging@1.0", queryOpenAging],
  ["entry_lag@1.2", entryLagV1_2],
  ["milestone_slip@1.0", milestoneSlip],
  // Lock-readiness (ADR-0014).
  ["lock_readiness_pct@1.0", lockReadinessPct],
  // Training and access mirrors (ADR-0013). v2.0 changed sourcing, not
  // math: the pipeline feeds it from the mirror tables (ADR-0019), and one
  // function serves both versions' DM-Q8 pins.
  ["training_current_pct@1.0", trainingCurrentPct],
  ["access_training_gap@2.0", accessTrainingGap],
  // DS starter set (ADR-0012), module: stat.
  ["pr_review_tat_median@1.1", prReviewTatMedianV1_1],
  ["pr_cycle_time_median@1.1", prCycleTimeMedianV1_1],
  ["issue_closure_lag_median@1.0", issueClosureLagMedian],
  ["issue_open_aging@1.0", issueOpenAging],
]);

export function computeFn(metricId: string, version: string): ComputeFn {
  const fn = registry.get(`${metricId}@${version}`);
  if (!fn) throw new Error(`no compute function registered for ${metricId}@${version}`);
  return fn;
}

export function assertRegistryMatchesSpecs(specs: LoadedSpec[] = loadSpecs()): LoadedSpec[] {
  const fromSpecs = new Set(specs.map((s) => `${s.spec.id}@${s.spec.version}`));
  for (const key of fromSpecs) {
    if (!registry.has(key)) {
      throw new Error(
        `metric ${key} is defined in metrics/ but has no registered compute function`,
      );
    }
  }
  for (const key of registry.keys()) {
    if (!fromSpecs.has(key)) {
      throw new Error(`compute function ${key} has no definition in metrics/`);
    }
  }
  return specs;
}
