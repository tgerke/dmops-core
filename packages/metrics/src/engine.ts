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

/**
 * Availability for a mirror-fed metric (ADR-0019): each required frame is
 * checked against the source that would feed that mirror — the first active
 * source, in the callers' deterministic adapter order, whose capabilities
 * support the frame (ADR-0013). Sources may differ per frame; that union is
 * what makes the split EDC + LMS deployment work. A frame with no feeder,
 * or a feeder missing a required field, is a named gap (DM-P1).
 */
export function mirrorFedAvailability(
  spec: MetricSpec,
  capabilitiesBySource: AdapterCapabilities[],
): MetricAvailability {
  const missing: string[] = [];
  const derived: string[] = [];
  for (const [frame, fields] of Object.entries(spec.required_fields)) {
    const feeder = capabilitiesBySource.find((c) => c.frames[frame as FrameName]?.supported);
    if (!feeder) {
      missing.push(`${frame} (no active source supports this frame)`);
      continue;
    }
    for (const field of fields) {
      const support = fieldSupport(feeder, frame as FrameName, field);
      if (support === "unsupported") missing.push(`${frame}.${field} (source '${feeder.adapter}')`);
      else if (support === "derived")
        derived.push(`${frame}.${field} (source '${feeder.adapter}')`);
    }
  }
  return missing.length > 0 ? { available: false, missing } : { available: true, derived };
}
