import type { NormalizedFrames } from "@dmops/adapter-contract";

/** One computed snapshot row, before database ids are resolved. */
export interface SnapshotValue {
  grain: "study" | "site";
  /** Adapter-side site key (site.site_number); null at study grain. */
  site_key: string | null;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  n_records: number;
}

/** dmops-owned milestone facts, for metrics whose source is this system. */
export interface MilestoneFact {
  code: string;
  occurrence: number;
  status: string;
  baseline_date: string | null;
  planned_date: string | null;
  forecast_date: string | null;
  actual_date: string | null;
}

export interface ComputeContext {
  /** Inclusive ISO date bounds of the reporting period. */
  periodStart: string;
  periodEnd: string;
  milestones?: MilestoneFact[];
}

/**
 * A metric computation is a pure function: frames in, snapshot values out.
 * No database, no clock, no source system — which is what makes the
 * qualification fixtures (DM-Q*) meaningful (ADR-0004).
 */
export type ComputeFn = (frames: NormalizedFrames, ctx: ComputeContext) => SnapshotValue[];

/** Elapsed calendar days between two ISO date/datetime strings. */
export function daysBetween(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000;
}

/** Median, rounded to one decimal; null on empty input. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(m * 10) / 10;
}

/** True when an ISO date/datetime falls within inclusive ISO date bounds. */
export function inPeriod(iso: string, periodStart: string, periodEnd: string): boolean {
  const t = Date.parse(iso);
  return t >= Date.parse(periodStart) && t < Date.parse(periodEnd) + 86_400_000;
}
