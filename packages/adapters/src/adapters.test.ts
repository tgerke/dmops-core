import { validateExtraction } from "@dmops/adapter-contract";
import { describe, expect, it } from "vitest";
import { csvAdapter } from "./csv/index.js";
import { createEdcCoreAdapter } from "./edc-core/index.js";

describe("csv adapter (the reference implementation)", () => {
  it("extracts all four frames from the fixture study and passes contract validation", async () => {
    const result = await csvAdapter.extract({
      sourceStudyKey: "DMOPS-001",
      frames: ["queries", "subjects", "visits", "pages"],
      config: { dir: "fixtures/study-DMOPS-001" },
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.row_counts).toEqual({ queries: 16, subjects: 8, visits: 6, pages: 8 });
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces a deterministic checksum for the same fixture (extract provenance)", async () => {
    const input = {
      sourceStudyKey: "DMOPS-001",
      frames: ["queries"] as ["queries"],
      config: { dir: "fixtures/study-DMOPS-001" },
    };
    const a = await csvAdapter.extract(input);
    const b = await csvAdapter.extract(input);
    expect(a.checksum).toBe(b.checksum);
  });
});

// Recorded response fixtures: shapes captured from edc-core's
// listStudyQueries / subject listing (see adapter header comment). No live
// EDC in CI — the mapping is what's under test.
const edcSubjects = [
  { id: "s-1", subjectKey: "1001", status: "enrolled", siteId: "site-a", siteName: "General" },
  { id: "s-2", subjectKey: "1002", status: "screening", siteId: "site-b", siteName: "Memorial" },
];

const edcQueries = [
  {
    id: "q-1",
    origin: "manual",
    status: "closed",
    openedBy: "cra.jones",
    createdAt: "2026-06-02T10:00:00.000Z",
    closedAt: "2026-06-06T10:00:00.000Z",
    subjectKey: "1001",
    formOid: "IG.AE",
    messages: [
      { author: "cra.jones", body: "Please clarify onset date", createdAt: "2026-06-02T10:00:00.000Z" },
      { author: "site.coordinator", body: "Corrected", createdAt: "2026-06-04T08:00:00.000Z" },
    ],
  },
  {
    id: "q-2",
    origin: "system",
    status: "open",
    openedBy: "system",
    createdAt: "2026-06-10T10:00:00.000Z",
    closedAt: null,
    subjectKey: "1002",
    formOid: "IG.VS",
    messages: [],
  },
];

function fakeFetch(): typeof fetch {
  return (async (url: URL | RequestInfo) => {
    const path = url.toString();
    const body = path.endsWith("/subjects")
      ? edcSubjects
      : path.endsWith("/queries")
        ? edcQueries
        : null;
    if (!body) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("edc-core adapter (reference EDC, recorded fixtures)", () => {
  const adapter = createEdcCoreAdapter(fakeFetch());
  const config = { baseUrl: "https://edc.example/", apiKeyEnv: "DMOPS_TEST_EDC_KEY" };

  it("maps query threads to the queries frame, deriving first_response_at from the thread", async () => {
    process.env.DMOPS_TEST_EDC_KEY = "test-key";
    const result = await adapter.extract({
      sourceStudyKey: "study-1",
      frames: ["queries", "subjects"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();

    const queries = result.frames.queries as Record<string, unknown>[];
    expect(queries[0]).toMatchObject({
      source_query_id: "q-1",
      subject_key: "1001",
      site_key: "site-a",
      form_key: "IG.AE",
      origin: "manual",
      status: "closed",
      opened_at: "2026-06-02T10:00:00.000Z",
      first_response_at: "2026-06-04T08:00:00.000Z",
      closed_at: "2026-06-06T10:00:00.000Z",
    });
    // No response from anyone but the opener → null, not a guess (DM-P1).
    expect(queries[1]).toMatchObject({ source_query_id: "q-2", first_response_at: null });
  });

  it("does not pass record creation off as an enrollment date (DM-P1)", async () => {
    process.env.DMOPS_TEST_EDC_KEY = "test-key";
    const result = await adapter.extract({
      sourceStudyKey: "study-1",
      frames: ["subjects"],
      config,
    });
    const subjects = result.frames.subjects as Record<string, unknown>[];
    expect(subjects.every((s) => s.enrolled_date === null)).toBe(true);
    expect(adapter.capabilities().frames.subjects?.fields.enrolled_date).toBe("unsupported");
  });

  it("declares visits unsupported and refuses to extract them (DM-P1: no silent approximation)", async () => {
    process.env.DMOPS_TEST_EDC_KEY = "test-key";
    expect(adapter.capabilities().frames.visits?.supported).toBe(false);
    await expect(
      adapter.extract({ sourceStudyKey: "study-1", frames: ["visits"], config }),
    ).rejects.toThrow(/unsupported/);
  });

  it("fails with an actionable message when the key env var is missing", async () => {
    delete process.env.DMOPS_TEST_EDC_KEY;
    await expect(
      adapter.extract({ sourceStudyKey: "study-1", frames: ["queries"], config }),
    ).rejects.toThrow(/DMOPS_TEST_EDC_KEY/);
  });
});
