import { entryLagV1_1 } from "./compute/entry_lag.js";
import { milestoneSlip } from "./compute/milestone_slip.js";
import { queryOpenAging } from "./compute/query_open_aging.js";
import { queryTatMedianV1_1 } from "./compute/query_tat_median.js";
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
  ["query_tat_median@1.1", queryTatMedianV1_1],
  ["query_open_aging@1.0", queryOpenAging],
  ["entry_lag@1.1", entryLagV1_1],
  ["milestone_slip@1.0", milestoneSlip],
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
