import type { AdapterCapabilities } from "@dmops/adapter-contract";
import { describe, expect, it } from "vitest";
import { metricAvailability } from "./engine.js";
import { assertRegistryMatchesSpecs } from "./registry.js";
import { loadSpecs } from "./spec.js";

const specs = loadSpecs();
const byId = (id: string) => {
  const found = specs.find((s) => s.spec.id === id);
  if (!found) throw new Error(`spec ${id} not found`);
  return found.spec;
};

describe("metric dictionary (DM-P2)", () => {
  it("every YAML definition has a registered compute function of the same version, and vice versa", () => {
    expect(() => assertRegistryMatchesSpecs(specs)).not.toThrow();
  });

  it("definitions carry the full written spec, not a label", () => {
    for (const { spec } of specs) {
      expect(spec.definition.length).toBeGreaterThan(20);
      expect(spec.clock_start).toBeTruthy();
      expect(spec.clock_stop).toBeTruthy();
    }
  });
});

describe("capability gating (DM-P1: skip, never silently approximate)", () => {
  // An adapter that cannot supply visit dates — edc-core's real posture.
  const noVisitDates: AdapterCapabilities = {
    adapter: "edc-core-like",
    frames: {
      queries: {
        supported: true,
        fields: {
          opened_at: "native",
          closed_at: "native",
          status: "native",
          first_response_at: "derived",
        },
      },
      subjects: { supported: true, fields: { subject_key: "native", status: "native" } },
      pages: { supported: true, fields: { first_entered_at: "derived" } },
      visits: { supported: false, fields: {} },
    },
  };

  it("entry_lag is unavailable when the source cannot supply visits.visit_date", () => {
    const result = metricAvailability(byId("entry_lag"), noVisitDates);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.missing).toContain("visits.visit_date");
  });

  it("query_tat_median runs on the same source, with derived fields annotated", () => {
    const result = metricAvailability(byId("query_tat_median"), noVisitDates);
    expect(result.available).toBe(true);
  });

  it("milestone_slip and lock_readiness_pct are always available — their source is dmops-core itself", () => {
    for (const id of ["milestone_slip", "lock_readiness_pct"]) {
      const result = metricAvailability(byId(id), { adapter: "anything", frames: {} });
      expect(result.available).toBe(true);
    }
  });
});
