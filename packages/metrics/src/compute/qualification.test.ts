/**
 * Metric qualification (DM-Q*): every compute function verified against
 * hand-computed expected values on the DMOPS-001 fixture study. This suite
 * is the qualification evidence — the traceability matrix joins on the
 * DM-Q tokens in the test names (docs/03-compliance.md).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NormalizedFrames } from "@dmops/adapter-contract";
import { csvAdapter } from "@dmops/adapters/csv";
import { beforeAll, describe, expect, it } from "vitest";
import type { MilestoneFact, SnapshotValue } from "../types.js";
import { entryLag } from "./entry_lag.js";
import { milestoneSlip } from "./milestone_slip.js";
import { queryOpenAging } from "./query_open_aging.js";
import { queryTatMedian } from "./query_tat_median.js";

const expected = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../fixtures/study-DMOPS-001/expected-values.json", import.meta.url)),
    "utf8",
  ),
);
const ctx = { periodStart: expected.period.start, periodEnd: expected.period.end };

let frames: NormalizedFrames;
beforeAll(async () => {
  const extraction = await csvAdapter.extract({
    sourceStudyKey: "DMOPS-001",
    frames: ["queries", "subjects", "visits", "pages"],
    config: { dir: "fixtures/study-DMOPS-001" },
  });
  frames = extraction.frames as NormalizedFrames;
});

const byGrain = (rows: SnapshotValue[], grain: string, siteKey: string | null = null) =>
  rows.find((r) => r.grain === grain && r.site_key === siteKey);

describe("metric qualification against hand-computed fixtures", () => {
  it("DM-Q1: query_tat_median matches hand-computed truth for DMOPS-001", () => {
    const rows = queryTatMedian(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.query_tat_median.study);
    expect(byGrain(rows, "site", "001")).toMatchObject(expected.query_tat_median.site["001"]);
    expect(byGrain(rows, "site", "002")).toMatchObject(expected.query_tat_median.site["002"]);
  });

  it("DM-Q2: query_open_aging matches hand-computed truth for DMOPS-001", () => {
    const rows = queryOpenAging(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.query_open_aging.study);
    expect(byGrain(rows, "site", "001")).toMatchObject(expected.query_open_aging.site["001"]);
    expect(byGrain(rows, "site", "002")).toMatchObject(expected.query_open_aging.site["002"]);
  });

  it("DM-Q3: entry_lag matches hand-computed truth for DMOPS-001", () => {
    const rows = entryLag(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.entry_lag.study);
  });

  it("DM-Q4: milestone_slip matches hand-computed truth on constructed milestone facts", () => {
    // Hand-constructed: slips +3, -2, +10 completed in period → median 3.0.
    // Excluded: na status, missing baseline, completed outside the period.
    const milestones: MilestoneFact[] = [
      fact("SPEC.DMP.APPROVED", "complete", "2026-06-02", "2026-06-05"), // +3
      fact("SPEC.CRF.APPROVED", "complete", "2026-06-12", "2026-06-10"), // -2
      fact("BUILD.DB.COMPLETE", "complete", "2026-06-08", "2026-06-18"), // +10
      fact("SPEC.SDTM", "na", "2026-06-01", "2026-06-01"),
      { ...fact("SPEC.CCG", "complete", "2026-06-01", "2026-06-20"), baseline_date: null },
      fact("SPEC.EDIT.DRAFT", "complete", "2026-05-01", "2026-05-30"), // outside period
    ];
    const rows = milestoneSlip(frames, { ...ctx, milestones });
    expect(byGrain(rows, "study")).toMatchObject({ value: 3.0, n_records: 3 });
  });

  it("DM-Q4: milestone_slip returns null with zero records when nothing completed in period", () => {
    const rows = milestoneSlip(frames, { ...ctx, milestones: [] });
    expect(byGrain(rows, "study")).toMatchObject({ value: null, n_records: 0 });
  });
});

function fact(code: string, status: string, baseline: string, actual: string): MilestoneFact {
  return {
    code,
    occurrence: 1,
    status,
    baseline_date: baseline,
    planned_date: baseline,
    forecast_date: null,
    actual_date: actual,
  };
}
