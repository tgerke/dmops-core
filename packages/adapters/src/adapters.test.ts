import { validateExtraction } from "@dmops/adapter-contract";
import { describe, expect, it } from "vitest";
import { csvAdapter } from "./csv/index.js";
import { createEdcCoreAdapter } from "./edc-core/index.js";
import { createGithubAdapter } from "./github/index.js";

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

  it("extracts the repository-work frames from the fixture study (ADR-0012)", async () => {
    const result = await csvAdapter.extract({
      sourceStudyKey: "DMOPS-001",
      frames: ["issues", "pull_requests", "reviews"],
      config: { dir: "fixtures/study-DMOPS-001" },
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.row_counts).toEqual({ issues: 9, pull_requests: 9, reviews: 10 });
  });

  it("extracts the roster frames from the fixture study (ADR-0013)", async () => {
    const result = await csvAdapter.extract({
      sourceStudyKey: "DMOPS-001",
      frames: ["training_records", "access_grants"],
      config: { dir: "fixtures/study-DMOPS-001" },
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.row_counts).toEqual({ training_records: 20, access_grants: 10 });
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
      {
        author: "cra.jones",
        body: "Please clarify onset date",
        createdAt: "2026-06-02T10:00:00.000Z",
      },
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

// Shapes from edc-core's members listing (see adapter header): current
// unrevoked grants only, service accounts already excluded by the endpoint.
const edcMembers = [
  {
    grantId: "g-1",
    userId: "u-1",
    username: "maya.okafor",
    fullName: "Maya Okafor",
    email: "maya.okafor@pmo.example",
    userStatus: "active",
    roleName: "data_manager",
    siteId: null,
    siteOid: null,
    siteName: null,
    grantedAt: "2026-04-20T14:00:00.000Z",
    grantedBy: "alex.admin",
  },
  {
    grantId: "g-2",
    userId: "u-2",
    username: "j.ellis",
    fullName: "Jordan Ellis",
    email: "j.ellis@site001.example",
    userStatus: "locked",
    roleName: "site_coordinator",
    siteId: "site-a",
    siteOid: "001",
    siteName: "General",
    grantedAt: "2026-04-27T13:00:00.000Z",
    grantedBy: "alex.admin",
  },
];

function fakeFetch(): typeof fetch {
  return (async (url: URL | RequestInfo) => {
    const path = url.toString();
    const body = path.endsWith("/subjects")
      ? edcSubjects
      : path.endsWith("/queries")
        ? edcQueries
        : path.endsWith("/members")
          ? edcMembers
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

  it("maps the members listing to current access grants (ADR-0013)", async () => {
    process.env.DMOPS_TEST_EDC_KEY = "test-key";
    const result = await adapter.extract({
      sourceStudyKey: "study-1",
      frames: ["access_grants"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.frames.access_grants).toEqual([
      {
        person_key: "maya.okafor@pmo.example",
        person_name: "Maya Okafor",
        role_key: "data_manager",
        site_key: null, // study-wide grant
        status: "active",
        granted_at: "2026-04-20T14:00:00.000Z",
      },
      {
        person_key: "j.ellis@site001.example",
        person_name: "Jordan Ellis",
        role_key: "site_coordinator",
        site_key: "001",
        status: "locked",
        granted_at: "2026-04-27T13:00:00.000Z",
      },
    ]);
  });

  it("declares training unsupported — an EDC is not an LMS (ADR-0013, DM-P1)", async () => {
    process.env.DMOPS_TEST_EDC_KEY = "test-key";
    expect(adapter.capabilities().frames.training_records?.supported).toBe(false);
    await expect(
      adapter.extract({ sourceStudyKey: "study-1", frames: ["training_records"], config }),
    ).rejects.toThrow(/unsupported/);
  });

  it("fails with an actionable message when the key env var is missing", async () => {
    process.env.DMOPS_TEST_EDC_KEY = "";
    await expect(
      adapter.extract({ sourceStudyKey: "study-1", frames: ["queries"], config }),
    ).rejects.toThrow(/DMOPS_TEST_EDC_KEY/);
  });
});

// Recorded response fixtures: shapes per the GitHub REST API reference
// (docs.github.com, X-GitHub-Api-Version 2026-03-10, consulted 2026-07-30 —
// see the adapter header). No live GitHub in CI — the mapping is under test.
const ghIssues = [
  {
    id: 9001,
    number: 41,
    state: "open",
    created_at: "2026-06-10T09:00:00Z",
    closed_at: null,
    title: "SDTM spec question on AE coding",
  },
  {
    id: 9002,
    number: 42,
    state: "closed",
    created_at: "2026-06-01T09:00:00Z",
    closed_at: "2026-06-05T09:00:00Z",
    title: "ADaM derivation mismatch",
  },
  // The issues endpoint returns PRs too; the pull_request key marks them.
  {
    id: 9003,
    number: 43,
    state: "open",
    created_at: "2026-06-12T09:00:00Z",
    closed_at: null,
    title: "Fix TLF footnote",
    pull_request: { url: "https://api.github.example/repos/acme/analysis/pulls/43" },
  },
];

const ghPulls = [
  {
    id: 7001,
    number: 43,
    state: "closed",
    created_at: "2026-06-12T09:00:00Z",
    merged_at: "2026-06-15T10:00:00Z",
    closed_at: "2026-06-15T10:00:00Z",
  },
  {
    id: 7002,
    number: 44,
    state: "closed",
    created_at: "2026-06-16T09:00:00Z",
    merged_at: null,
    closed_at: "2026-06-18T09:00:00Z",
  },
  {
    id: 7003,
    number: 45,
    state: "open",
    created_at: "2026-06-20T09:00:00Z",
    merged_at: null,
    closed_at: null,
  },
];

const ghReviewsByPull: Record<string, unknown[]> = {
  "43": [
    {
      id: 5001,
      user: { login: "omar-h" },
      state: "APPROVED",
      submitted_at: "2026-06-13T10:00:00Z",
    },
    // Pending reviews are unsubmitted and carry no submitted_at.
    { id: 5002, user: { login: "priya-n" }, state: "PENDING" },
  ],
  "44": [
    { id: 5003, user: null, state: "CHANGES_REQUESTED", submitted_at: "2026-06-17T10:00:00Z" },
  ],
  "45": [],
};

function fakeGithubFetch(): typeof fetch {
  return (async (url: URL | RequestInfo) => {
    const u = new URL(url.toString());
    const respond = (body: unknown, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json", ...headers },
      });
    const reviews = u.pathname.match(/\/repos\/acme\/analysis\/pulls\/(\d+)\/reviews$/);
    if (reviews) return respond(ghReviewsByPull[reviews[1]!] ?? []);
    if (u.pathname === "/repos/acme/analysis/pulls") return respond(ghPulls);
    // Issues paginate: page 1 links to page 2 via the Link header.
    if (u.pathname === "/repos/acme/analysis/issues" && u.searchParams.get("page") === "2") {
      return respond(ghIssues.slice(2));
    }
    if (u.pathname === "/repos/acme/analysis/issues") {
      return respond(ghIssues.slice(0, 2), {
        link: `<${u.origin}/repos/acme/analysis/issues?state=all&per_page=100&page=2>; rel="next"`,
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("github adapter (recorded fixtures, ADR-0012)", () => {
  const adapter = createGithubAdapter(fakeGithubFetch());
  const config = {
    repos: ["acme/analysis"],
    apiTokenEnv: "DMOPS_TEST_GITHUB_TOKEN",
    baseUrl: "https://api.github.example",
  };

  it("maps issues, filtering out pull requests and following Link pagination", async () => {
    process.env.DMOPS_TEST_GITHUB_TOKEN = "test-token";
    const result = await adapter.extract({
      sourceStudyKey: "DMOPS-001",
      frames: ["issues"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.row_counts).toEqual({ issues: 2 }); // number 43 is a PR, not an issue
    expect(result.frames.issues).toEqual([
      {
        source_issue_id: "41",
        repo_key: "acme/analysis",
        state: "open",
        opened_at: "2026-06-10T09:00:00Z",
        closed_at: null,
      },
      {
        source_issue_id: "42",
        repo_key: "acme/analysis",
        state: "closed",
        opened_at: "2026-06-01T09:00:00Z",
        closed_at: "2026-06-05T09:00:00Z",
      },
    ]);
  });

  it("derives the three-valued PR state from GitHub's open|closed plus merged_at", async () => {
    process.env.DMOPS_TEST_GITHUB_TOKEN = "test-token";
    const result = await adapter.extract({
      sourceStudyKey: "DMOPS-001",
      frames: ["pull_requests"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    const states = (result.frames.pull_requests as { source_pr_id: string; state: string }[]).map(
      (p) => [p.source_pr_id, p.state],
    );
    expect(states).toEqual([
      ["43", "merged"],
      ["44", "closed"],
      ["45", "open"],
    ]);
    expect(adapter.capabilities().frames.pull_requests?.fields.state).toBe("derived");
  });

  it("maps submitted reviews and excludes pending ones (no submitted_at to report)", async () => {
    process.env.DMOPS_TEST_GITHUB_TOKEN = "test-token";
    const result = await adapter.extract({
      sourceStudyKey: "DMOPS-001",
      frames: ["reviews"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.frames.reviews).toEqual([
      {
        source_review_id: "5001",
        source_pr_id: "43",
        repo_key: "acme/analysis",
        reviewer_key: "omar-h",
        state: "approved",
        submitted_at: "2026-06-13T10:00:00Z",
      },
      {
        source_review_id: "5003",
        source_pr_id: "44",
        repo_key: "acme/analysis",
        reviewer_key: "unknown", // deleted account: user is null in the response
        state: "changes_requested",
        submitted_at: "2026-06-17T10:00:00Z",
      },
    ]);
  });

  it("declares EDC frames unsupported and refuses to extract them (DM-P1: no silent approximation)", async () => {
    process.env.DMOPS_TEST_GITHUB_TOKEN = "test-token";
    expect(adapter.capabilities().frames.queries).toBeUndefined();
    await expect(
      adapter.extract({ sourceStudyKey: "DMOPS-001", frames: ["queries"], config }),
    ).rejects.toThrow(/unsupported/);
  });

  it("fails with an actionable message when the token env var is missing", async () => {
    process.env.DMOPS_TEST_GITHUB_TOKEN = "";
    await expect(
      adapter.extract({ sourceStudyKey: "DMOPS-001", frames: ["issues"], config }),
    ).rejects.toThrow(/DMOPS_TEST_GITHUB_TOKEN/);
  });
});
