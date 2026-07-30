import { type AdapterCapabilities, type FrameName, fieldSupport } from "@dmops/adapter-contract";
import type { MetricSpec } from "./spec.js";

export type MetricAvailability =
  | { available: true; derived: string[] }
  | { available: false; missing: string[] };

/**
 * Capability gating (ADR-0005, DM-P1): a metric runs only when every field it
 * requires is native or derived in the study's adapter. Otherwise it is
 * skipped and reported unavailable with the named gaps — never silently
 * approximated.
 */
export function metricAvailability(
  spec: MetricSpec,
  capabilities: AdapterCapabilities,
): MetricAvailability {
  const missing: string[] = [];
  const derived: string[] = [];
  for (const [frame, fields] of Object.entries(spec.required_fields)) {
    for (const field of fields) {
      const support = fieldSupport(capabilities, frame as FrameName, field);
      if (support === "unsupported") missing.push(`${frame}.${field}`);
      else if (support === "derived") derived.push(`${frame}.${field}`);
    }
  }
  return missing.length > 0 ? { available: false, missing } : { available: true, derived };
}
