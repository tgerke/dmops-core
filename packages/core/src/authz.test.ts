/**
 * Pure predicate tests for the phase-scoped write posture (ADR-0011).
 * The API-level enforcement (which milestone codes and deliverable types
 * route to which predicate) is covered in apps/api/src/app.test.ts.
 */
import { describe, expect, it } from "vitest";
import { ANALYSIS_DELIVERABLE_TYPES, type Assignment, canWriteAnalysis } from "./authz.js";

const S1 = "study-1";
const S2 = "study-2";
const on = (role: Assignment["role"], studyId = S1): Assignment => ({ studyId, role });

describe("canWriteAnalysis (ADR-0011)", () => {
  it("DM-P6: programmer and biostat assigned to the study can write analysis-phase work", () => {
    expect(canWriteAnalysis([on("programmer")], S1)).toBe(true);
    expect(canWriteAnalysis([on("biostat")], S1)).toBe(true);
  });

  it("DM-P5: the posture is study-scoped — the same roles on another study cannot", () => {
    expect(canWriteAnalysis([on("programmer", S2)], S1)).toBe(false);
    expect(canWriteAnalysis([on("biostat", S2)], S1)).toBe(false);
  });

  it("DM leadership and admin keep their write everywhere the milestone predicate grants it", () => {
    expect(canWriteAnalysis([on("dm_lead")], S1)).toBe(true);
    expect(canWriteAnalysis([on("dm_manager")], S1)).toBe(true);
    // admin is portfolio-wide, matching canWriteMilestones
    expect(canWriteAnalysis([on("admin", S2)], S1)).toBe(true);
  });

  it("read seats and the analyst stay out: analysis entry belongs to the analysis team", () => {
    for (const role of ["analyst", "clinops", "sponsor_user", "qa"] as const) {
      expect(canWriteAnalysis([on(role)], S1)).toBe(false);
    }
    expect(canWriteAnalysis([], S1)).toBe(false);
  });

  it("the analysis deliverable types are exactly the ADR-0011 set; sdtm_spec stays DM", () => {
    expect([...ANALYSIS_DELIVERABLE_TYPES].sort()).toEqual(["adam_spec", "sap", "tlf_shells"]);
    expect(ANALYSIS_DELIVERABLE_TYPES.has("sdtm_spec")).toBe(false);
  });
});
