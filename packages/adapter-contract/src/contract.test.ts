import { describe, expect, it } from "vitest";
import { validateExtraction } from "./adapter.js";
import { type AdapterCapabilities, fieldSupport } from "./capabilities.js";
import { checksumFrames } from "./checksum.js";
import { pullRequestRow, queryRow, reviewRow } from "./frames.js";

const validQuery = {
  source_query_id: "Q-1",
  site_key: "001",
  subject_key: "001-001",
  form_key: "AE",
  origin: "manual",
  status: "closed",
  opened_at: "2026-05-01T10:00:00Z",
  first_response_at: "2026-05-03T09:00:00Z",
  closed_at: "2026-05-04T12:00:00Z",
};

describe("frame schemas (DM-P1: one normalized shape per fact)", () => {
  it("accepts a conforming query row", () => {
    expect(queryRow.parse(validQuery)).toEqual(validQuery);
  });

  it("rejects unknown keys — adapters cannot smuggle source-specific fields", () => {
    expect(() => queryRow.parse({ ...validQuery, rave_specific: true })).toThrow();
  });

  it("rejects non-ISO timestamps", () => {
    expect(() => queryRow.parse({ ...validQuery, opened_at: "05/01/2026" })).toThrow();
  });
});

describe("repository-work frame schemas (ADR-0012)", () => {
  const validPr = {
    source_pr_id: "43",
    repo_key: "acme/analysis",
    state: "merged",
    opened_at: "2026-06-12T09:00:00Z",
    merged_at: "2026-06-15T10:00:00Z",
    closed_at: "2026-06-15T10:00:00Z",
  };

  it("accepts a conforming pull request row and rejects vendor states", () => {
    expect(pullRequestRow.parse(validPr)).toEqual(validPr);
    expect(() => pullRequestRow.parse({ ...validPr, state: "MERGED" })).toThrow();
  });

  it("requires a submitted timestamp on reviews — pending reviews have no place here", () => {
    const validReview = {
      source_review_id: "5001",
      source_pr_id: "43",
      repo_key: "acme/analysis",
      reviewer_key: "omar-h",
      state: "approved",
      submitted_at: "2026-06-13T10:00:00Z",
    };
    expect(reviewRow.parse(validReview)).toEqual(validReview);
    expect(() => reviewRow.parse({ ...validReview, submitted_at: null })).toThrow();
    expect(() => reviewRow.parse({ ...validReview, state: "pending" })).toThrow();
  });
});

describe("extraction validation", () => {
  it("validates rows and row counts together", () => {
    const frames = { queries: [validQuery] };
    expect(() =>
      validateExtraction({
        extracted_at: "2026-07-30T00:00:00Z",
        frames,
        row_counts: { queries: 1 },
        checksum: checksumFrames(frames),
      }),
    ).not.toThrow();
    expect(() =>
      validateExtraction({
        extracted_at: "2026-07-30T00:00:00Z",
        frames,
        row_counts: { queries: 2 },
        checksum: checksumFrames(frames),
      }),
    ).toThrow(/row_counts mismatch/);
  });

  it("names the frame, row, and field on failure", () => {
    expect(() =>
      validateExtraction({
        extracted_at: "2026-07-30T00:00:00Z",
        frames: { queries: [{ ...validQuery, status: "resolved" }] },
        row_counts: { queries: 1 },
        checksum: "x".repeat(64),
      }),
    ).toThrow(/queries.*row 0.*status/);
  });
});

describe("checksum determinism (extract provenance, ADR-0007)", () => {
  it("is stable across key order", () => {
    const a = checksumFrames({ queries: [{ b: 1, a: 2 }] });
    const b = checksumFrames({ queries: [{ a: 2, b: 1 }] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any value changes", () => {
    expect(checksumFrames({ queries: [{ a: 1 }] })).not.toBe(
      checksumFrames({ queries: [{ a: 2 }] }),
    );
  });
});

describe("capability gating support (ADR-0005)", () => {
  const caps: AdapterCapabilities = {
    adapter: "test",
    frames: {
      queries: {
        supported: true,
        fields: { opened_at: "native", first_response_at: "derived" },
      },
      visits: { supported: false, fields: {} },
    },
  };

  it("resolves native, derived, and unsupported fields", () => {
    expect(fieldSupport(caps, "queries", "opened_at")).toBe("native");
    expect(fieldSupport(caps, "queries", "first_response_at")).toBe("derived");
    expect(fieldSupport(caps, "queries", "closed_at")).toBe("unsupported");
  });

  it("treats an unsupported frame as unsupported for every field", () => {
    expect(fieldSupport(caps, "visits", "visit_date")).toBe("unsupported");
  });

  it("treats an undeclared frame as unsupported", () => {
    expect(fieldSupport(caps, "pages", "first_entered_at")).toBe("unsupported");
  });
});
