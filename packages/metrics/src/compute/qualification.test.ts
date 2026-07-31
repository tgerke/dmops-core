/**
 * Metric qualification (DM-Q* for the DM suite, DS-Q* for the stat-module
 * starter set, ADR-0012): every compute function verified against
 * hand-computed expected values on the DMOPS-001 fixture study. This suite
 * is the qualification evidence — the traceability matrix joins on the
 * DM-Q/DS-Q tokens in the test names (docs/03-compliance.md).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NormalizedFrames } from "@dmops/adapter-contract";
import { csvAdapter } from "@dmops/adapters/csv";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadCalendars, resolveCalendar } from "../calendars.js";
import {
  type MilestoneDefinitionFact,
  type MilestoneFact,
  type SnapshotValue,
  businessDaysBetween,
} from "../types.js";
import { accessTrainingGap } from "./access_training_gap.js";
import { entryLag, entryLagV1_1, entryLagV1_2 } from "./entry_lag.js";
import { issueClosureLagMedian } from "./issue_closure_lag_median.js";
import { issueOpenAging } from "./issue_open_aging.js";
import { lockReadinessPct } from "./lock_readiness_pct.js";
import { milestoneSlip } from "./milestone_slip.js";
import { prCycleTimeMedian, prCycleTimeMedianV1_1 } from "./pr_cycle_time_median.js";
import { prReviewTatMedian, prReviewTatMedianV1_1 } from "./pr_review_tat_median.js";
import { queryOpenAging } from "./query_open_aging.js";
import { queryTatMedian, queryTatMedianV1_1, queryTatMedianV1_2 } from "./query_tat_median.js";
import { trainingCurrentPct } from "./training_current_pct.js";

const expected = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../../fixtures/study-DMOPS-001/expected-values.json", import.meta.url),
    ),
    "utf8",
  ),
);
const ctx = { periodStart: expected.period.start, periodEnd: expected.period.end };

let frames: NormalizedFrames;
beforeAll(async () => {
  const extraction = await csvAdapter.extract({
    sourceStudyKey: "DMOPS-001",
    frames: [
      "queries",
      "subjects",
      "visits",
      "pages",
      "issues",
      "pull_requests",
      "reviews",
      "training_records",
      "access_grants",
    ],
    config: { dir: "fixtures/study-DMOPS-001" },
  });
  frames = extraction.frames as NormalizedFrames;
});

const byGrain = (rows: SnapshotValue[], grain: string, siteKey: string | null = null) =>
  rows.find((r) => r.grain === grain && r.site_key === siteKey);

describe("metric qualification against hand-computed fixtures", () => {
  it("DM-Q1: query_tat_median v1.0 (calendar days, history-pinned) matches hand-computed truth for DMOPS-001", () => {
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

  it("DM-Q3: entry_lag v1.0 (calendar days, history-pinned) matches hand-computed truth for DMOPS-001", () => {
    const rows = entryLag(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.entry_lag.study);
  });

  it("DM-Q5: query_tat_median v1.1 (business days) matches hand-computed truth for DMOPS-001", () => {
    const rows = queryTatMedianV1_1(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.query_tat_median_v1_1.study);
    expect(byGrain(rows, "site", "001")).toMatchObject(expected.query_tat_median_v1_1.site["001"]);
    expect(byGrain(rows, "site", "002")).toMatchObject(expected.query_tat_median_v1_1.site["002"]);
  });

  it("DM-Q6: entry_lag v1.1 (business days) matches hand-computed truth for DMOPS-001", () => {
    const rows = entryLagV1_1(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.entry_lag_v1_1.study);
  });

  // The shipped calendar, read verbatim: the same governed file the pipeline
  // resolves (ADR-0016), so these tests pin the fixture dates and the
  // compute to one truth — a calendar edit that moves a June date fails
  // here, not silently in production numbers.
  const holidays = resolveCalendar("pmo", loadCalendars());

  it("DM-Q5: query_tat_median v1.2 (holiday-aware) matches hand-computed truth under the shipped calendar", () => {
    const rows = queryTatMedianV1_2(frames, { ...ctx, holidays });
    expect(byGrain(rows, "study")).toMatchObject(expected.query_tat_median_v1_2.study);
    expect(byGrain(rows, "site", "001")).toMatchObject(expected.query_tat_median_v1_2.site["001"]);
    expect(byGrain(rows, "site", "002")).toMatchObject(expected.query_tat_median_v1_2.site["002"]);
  });

  it("DM-Q5: query_tat_median v1.2 with no calendar reproduces the v1.1 weekday-only truth", () => {
    // "No calendar counts weekdays only" is part of the v1.2 definition.
    const rows = queryTatMedianV1_2(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.query_tat_median_v1_1.study);
  });

  it("DM-Q6: entry_lag v1.2 (holiday-aware) matches hand-computed truth under the shipped calendar", () => {
    const rows = entryLagV1_2(frames, { ...ctx, holidays });
    expect(byGrain(rows, "study")).toMatchObject(expected.entry_lag_v1_2.study);
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

  // The shipped taxonomy, read verbatim: the same governed file the SQL view
  // derives from, so this suite pins both closures to one gate list
  // (ADR-0014).
  const SHIPPED_GATES = [
    "CLOSE.LPO",
    "CLOSE.ENTRY",
    "CLOSE.QUERY",
    "CLOSE.SAE",
    "CLOSE.CODE",
    "CLOSE.EXT",
    "CLOSE.SDV",
    "CLOSE.SOFTLOCK",
  ];
  const taxonomyDefs = (): MilestoneDefinitionFact[] => {
    const raw = readFileSync(
      fileURLToPath(new URL("../../../../taxonomy/milestone_definitions.yaml", import.meta.url)),
      "utf8",
    );
    const parsed = parse(raw) as {
      milestones: { code: string; depends_on?: string[]; module?: string }[];
    };
    return parsed.milestones.map((m) => ({
      code: m.code,
      depends_on: m.depends_on ?? [],
      module: m.module ?? "dm",
      active: true,
    }));
  };

  it("DM-Q9: lock_readiness_pct derives the gate set from the shipped taxonomy and matches hand-computed truth", () => {
    const definitions = taxonomyDefs();
    // Hand-constructed: LPO and ENTRY completed by period end; SAE completed
    // after period end (not yet satisfied then); SDV marked na (excluded);
    // a non-gate completion (COND.REVIEW.FIRST) changes nothing.
    const milestones: MilestoneFact[] = [
      fact("CLOSE.LPO", "complete", "2026-05-01", "2026-05-10"),
      fact("CLOSE.ENTRY", "complete", "2026-06-01", "2026-06-15"),
      fact("CLOSE.SAE", "complete", "2026-06-20", "2026-07-05"),
      fact("CLOSE.SDV", "na", "2026-06-01", "2026-06-01"),
      fact("COND.REVIEW.FIRST", "complete", "2026-06-01", "2026-06-10"),
    ];
    const rows = lockReadinessPct({}, { ...ctx, milestones, definitions });
    // 8 gates, SDV na → 7 applicable; LPO + ENTRY satisfied → 2/7 = 28.6%.
    expect(byGrain(rows, "study")).toMatchObject({
      value: 28.6,
      numerator: 2,
      denominator: 7,
      n_records: 7,
    });
    expect(rows).toHaveLength(1); // study grain only
  });

  it("DM-Q9: the shipped closure is exactly the eight closeout gates — completing them all scores 100", () => {
    const definitions = taxonomyDefs();
    // No milestone rows at all: every gate applicable, none satisfied —
    // absence reads as "not done", and the denominator pins the gate count.
    const empty = lockReadinessPct({}, { ...ctx, milestones: [], definitions });
    expect(byGrain(empty, "study")).toMatchObject({ value: 0, denominator: 8 });

    // Completing exactly the expected codes scores 100: if the closure held
    // any other code, the denominator would exceed the completions.
    const allDone = SHIPPED_GATES.map((code) => fact(code, "complete", "2026-06-01", "2026-06-10"));
    const full = lockReadinessPct({}, { ...ctx, milestones: allDone, definitions });
    expect(byGrain(full, "study")).toMatchObject({ value: 100, numerator: 8, denominator: 8 });
  });

  it("DM-Q9: without definitions there is no checklist — null, never a guessed score", () => {
    const rows = lockReadinessPct({}, { ...ctx, milestones: [] });
    expect(byGrain(rows, "study")).toMatchObject({ value: null, n_records: 0 });
  });

  it("DM-Q7: training_current_pct v1.0 matches hand-computed truth for DMOPS-001", () => {
    const rows = trainingCurrentPct(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.training_current_pct.study);
    expect(rows).toHaveLength(1); // study grain only
  });

  it("DM-Q7: training_current_pct returns null with zero records when nothing is required yet", () => {
    const early = trainingCurrentPct(
      { training_records: frames.training_records },
      { periodStart: "2026-01-01", periodEnd: "2026-01-31" },
    );
    // Only the undated assignment (required now) is in scope in January.
    expect(byGrain(early, "study")).toMatchObject({ denominator: 1 });
    const none = trainingCurrentPct({ training_records: [] }, ctx);
    expect(byGrain(none, "study")).toMatchObject({ value: null, n_records: 0 });
  });

  it("DM-Q8: access_training_gap v1.0 matches hand-computed truth for DMOPS-001", () => {
    const rows = accessTrainingGap(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.access_training_gap.study);
  });

  it("DM-Q8: access_training_gap counts access with no training on file, and ignores inactive accounts", () => {
    const rows = accessTrainingGap(
      {
        access_grants: [
          grant("untrained@x.example", "active"),
          grant("deactivated@x.example", "deactivated"),
          grant("locked@x.example", "locked"),
        ],
        training_records: [],
      },
      ctx,
    );
    // Only the active holder counts, and absence of training is the gap.
    expect(byGrain(rows, "study")).toMatchObject({ value: 1, denominator: 1 });
  });
});

describe("DS metric qualification against hand-computed fixtures (stat module, ADR-0012)", () => {
  it("DS-Q1: pr_review_tat_median v1.0 (business days) matches hand-computed truth for DMOPS-001", () => {
    const rows = prReviewTatMedian(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.pr_review_tat_median.study);
    expect(rows).toHaveLength(1); // study grain only — no site rows for repository work
  });

  it("DS-Q2: pr_cycle_time_median v1.0 (business days) matches hand-computed truth for DMOPS-001", () => {
    const rows = prCycleTimeMedian(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.pr_cycle_time_median.study);
  });

  const holidays = resolveCalendar("pmo", loadCalendars());

  it("DS-Q1: pr_review_tat_median v1.1 (holiday-aware) matches hand-computed truth under the shipped calendar", () => {
    const rows = prReviewTatMedianV1_1(frames, { ...ctx, holidays });
    expect(byGrain(rows, "study")).toMatchObject(expected.pr_review_tat_median_v1_1.study);
    expect(rows).toHaveLength(1);
  });

  it("DS-Q2: pr_cycle_time_median v1.1 (holiday-aware) matches hand-computed truth under the shipped calendar", () => {
    const rows = prCycleTimeMedianV1_1(frames, { ...ctx, holidays });
    expect(byGrain(rows, "study")).toMatchObject(expected.pr_cycle_time_median_v1_1.study);
  });

  it("DS-Q3: issue_closure_lag_median v1.0 (calendar days) matches hand-computed truth for DMOPS-001", () => {
    const rows = issueClosureLagMedian(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.issue_closure_lag_median.study);
  });

  it("DS-Q4: issue_open_aging v1.0 matches hand-computed truth for DMOPS-001", () => {
    const rows = issueOpenAging(frames, ctx);
    expect(byGrain(rows, "study")).toMatchObject(expected.issue_open_aging.study);
  });
});

describe("businessDaysBetween (the v1.1 day-counting rule, ADR-0004)", () => {
  it("counts weekdays strictly after the start date through the end date", () => {
    expect(businessDaysBetween("2026-06-01", "2026-06-05")).toBe(4); // Mon → Fri
    expect(businessDaysBetween("2026-06-02T10:00:00Z", "2026-06-04T10:00:00Z")).toBe(2);
  });

  it("skips weekends: Friday to Monday is one business day", () => {
    expect(businessDaysBetween("2026-06-05", "2026-06-08")).toBe(1);
    expect(businessDaysBetween("2026-06-05", "2026-06-15")).toBe(6); // spans two weekends
  });

  it("weekend endpoints contribute nothing", () => {
    expect(businessDaysBetween("2026-06-06", "2026-06-07")).toBe(0); // Sat → Sun
    expect(businessDaysBetween("2026-06-06", "2026-06-11")).toBe(4); // Sat → Thu
    expect(businessDaysBetween("2026-06-12", "2026-06-20")).toBe(5); // Fri → Sat
  });

  it("same-day is zero and reversed inputs negate", () => {
    expect(businessDaysBetween("2026-06-03", "2026-06-03")).toBe(0);
    expect(businessDaysBetween("2026-06-08", "2026-06-05")).toBe(-1);
  });

  it("subtracts holiday dates, and a weekend holiday changes nothing (ADR-0016)", () => {
    // Mon 6/15 as a holiday: Fri 6/12 → Wed 6/17 counts {16,17} = 2.
    expect(businessDaysBetween("2026-06-12", "2026-06-17", ["2026-06-15"])).toBe(2);
    // Sat 6/13 listed as a holiday is already a non-working date.
    expect(businessDaysBetween("2026-06-12", "2026-06-17", ["2026-06-13"])).toBe(3);
    // Reversed inputs still negate under a calendar.
    expect(businessDaysBetween("2026-06-17", "2026-06-12", ["2026-06-15"])).toBe(-2);
    // An empty calendar is the weekday-only rule.
    expect(businessDaysBetween("2026-06-12", "2026-06-17", [])).toBe(3);
  });
});

function grant(personKey: string, status: "active" | "locked" | "deactivated") {
  return {
    person_key: personKey,
    person_name: null,
    role_key: "data_manager",
    site_key: null,
    status,
    granted_at: "2026-05-01T09:00:00Z",
  };
}

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
