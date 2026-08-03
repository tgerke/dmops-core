import type { AdapterCapabilities } from "@dmops/adapter-contract";
import {
  csvAdapter,
  edcCoreAdapter,
  medrioAdapter,
  raveAdapter,
  vaultTrainingAdapter,
} from "@dmops/adapters";
import { describe, expect, it } from "vitest";
import { metricAvailability, mirrorFedAvailability } from "./engine.js";
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

  // The vendor adapters' real postures (ADR-0017): honest capabilities, not
  // hypothetical ones, drive what a study computes.
  it("the medrio adapter's honest capabilities gate off the whole EDC metric set with named gaps (ADR-0017, DM-P1)", () => {
    const caps = medrioAdapter.capabilities();
    for (const id of ["query_tat_median", "query_open_aging"]) {
      const result = metricAvailability(byId(id), caps);
      expect(result.available).toBe(false);
      if (!result.available) expect(result.missing).toContain("queries.opened_at");
    }
    const entryLag = metricAvailability(byId("entry_lag"), caps);
    expect(entryLag.available).toBe(false);
    if (!entryLag.available) {
      expect(entryLag.missing).toContain("visits.visit_date");
      expect(entryLag.missing).toContain("pages.first_entered_at");
    }
  });

  it("the rave adapter lights the query metrics as derived and keeps entry_lag off (ADR-0017, DM-P1)", () => {
    const caps = raveAdapter.capabilities();
    for (const id of ["query_tat_median", "query_open_aging"]) {
      const result = metricAvailability(byId(id), caps);
      expect(result.available).toBe(true);
      if (result.available) expect(result.derived).toContain("queries.opened_at");
    }
    const entryLag = metricAvailability(byId("entry_lag"), caps);
    expect(entryLag.available).toBe(false);
    if (!entryLag.available) expect(entryLag.missing).toEqual(["visits.visit_date"]);
  });

  it("input 'mirrors' is declared only by the mirror frames' metric (ADR-0019)", () => {
    for (const { spec } of specs) {
      if (spec.input === "mirrors") {
        expect(spec.id).toBe("access_training_gap");
        expect(spec.source_frames.sort()).toEqual(["access_grants", "training_records"]);
      }
    }
  });

  it("a visit-date CRF mapping in the source config lights entry_lag as derived (ADR-0018, DM-P1)", () => {
    const mapped = raveAdapter.capabilities({
      baseUrl: "https://rave.example/",
      usernameEnv: "RAVE_USER",
      passwordEnv: "RAVE_PASSWORD",
      statusMap: { Enrolled: "enrolled" },
      visitDateItem: { formOid: "FORM_DM", itemOid: "DM.VISDAT", dateFormat: "dd MMM yyyy" },
    });
    const entryLag = metricAvailability(byId("entry_lag"), mapped);
    expect(entryLag.available).toBe(true);
    if (entryLag.available) expect(entryLag.derived).toContain("visits.visit_date");
  });
});

describe("mirror-fed availability (ADR-0019, DM-P1)", () => {
  const gapSpec = () => {
    const found = specs.find((s) => s.spec.id === "access_training_gap");
    if (!found) throw new Error("access_training_gap spec not found");
    return found.spec;
  };

  it("a split deployment — access from edc-core, training from Vault Training — feeds the metric across sources (ADR-0020)", () => {
    // The posture ADR-0019 pinned synthetically now comes from the shipped
    // adapter: expires_date arrives derived (constantly null under Vault's
    // recurrence model), and availability says so instead of claiming native.
    const result = mirrorFedAvailability(gapSpec(), [
      edcCoreAdapter.capabilities(),
      vaultTrainingAdapter.capabilities(),
    ]);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.derived).toContain("training_records.expires_date (source 'vault-training')");
    }
  });

  it("an EDC alone leaves the training frame with no feeder, and the gap is named", () => {
    const result = mirrorFedAvailability(gapSpec(), [edcCoreAdapter.capabilities()]);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.missing).toEqual(["training_records (no active source supports this frame)"]);
    }
  });

  it("a single source covering both frames still feeds the metric — the demo posture", () => {
    const result = mirrorFedAvailability(gapSpec(), [csvAdapter.capabilities()]);
    expect(result.available).toBe(true);
  });

  it("a feeder that supports the frame but not a required field is a named gap, not an approximation", () => {
    const noExpiry: AdapterCapabilities = {
      adapter: "lms-no-expiry",
      frames: {
        training_records: {
          supported: true,
          fields: { person_key: "native", due_date: "native", completed_date: "native" },
        },
      },
    };
    const result = mirrorFedAvailability(gapSpec(), [edcCoreAdapter.capabilities(), noExpiry]);
    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.missing).toEqual(["training_records.expires_date (source 'lms-no-expiry')"]);
    }
  });
});
