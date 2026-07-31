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

/**
 * Milestone definition facts, for metrics that derive from the governed
 * taxonomy's dependency graph (ADR-0014).
 */
export interface MilestoneDefinitionFact {
  code: string;
  depends_on: string[];
  module: string;
  active: boolean;
}

export interface ComputeContext {
  /** Inclusive ISO date bounds of the reporting period. */
  periodStart: string;
  periodEnd: string;
  milestones?: MilestoneFact[];
  definitions?: MilestoneDefinitionFact[];
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

/**
 * Elapsed business days (Mon–Fri): the count of weekday UTC dates strictly
 * after start's date, up to and including end's date. Integer, unlike
 * daysBetween. v1.1 has no holiday calendar — per-country holidays are a
 * future versioned change (ADR-0004).
 */
export function businessDaysBetween(start: string, end: string): number {
  // ISO date-only strings parse as UTC midnight, so both forms land on the
  // right epoch day.
  const epochDay = (iso: string) => Math.floor(Date.parse(iso) / 86_400_000);
  const from = epochDay(start);
  const to = epochDay(end);
  if (to < from) return -businessDaysBetween(end, start);
  let count = 0;
  for (let d = from + 1; d <= to; d++) {
    const dow = (d + 4) % 7; // epoch day 0 (1970-01-01) was a Thursday
    if (dow !== 0 && dow !== 6) count++; // 0 = Sunday, 6 = Saturday
  }
  return count;
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
