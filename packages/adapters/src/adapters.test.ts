import { constants, createHash, verify as cryptoVerify, publicDecrypt } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateExtraction } from "@dmops/adapter-contract";
import { describe, expect, it } from "vitest";
import { csvAdapter } from "./csv/index.js";
import { createEdcCoreAdapter } from "./edc-core/index.js";
import { createGithubAdapter } from "./github/index.js";
import { createMedrioAdapter } from "./medrio/index.js";
import { createRaveAdapter } from "./rave/index.js";
import { stringToSignV1, stringToSignV2 } from "./rave/mauth.js";
import { createVaultTrainingAdapter } from "./vault-training/index.js";

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

// Recorded response fixtures: shapes per the Medrio OpenAPI document
// (connectapi.medrio.com/swagger/v1/swagger.json, "Medrio OpenApi
// v.42.14.0.201", fetched 2026-07-31 — see the adapter header, ADR-0017).
// No live EDC in CI — the mapping is what's under test. Fixtures carry PII
// fields (firstName, lastName, dateOfBirth) the adapter must never read.
const medrioEnvelope = (response: unknown) => ({
  processedSuccessfully: true,
  processMessage: null,
  response,
});

const medrioSites = [
  { siteId: "ms-1", externalId: "S1", name: "General", siteNumber: "101" },
  { siteId: "ms-2", externalId: "S2", name: "Memorial", siteNumber: "102" },
];

const medrioSubjects = [
  {
    subjectId: "uuid-1",
    subjectIdentifier: "101-001",
    firstName: "Pat",
    lastName: "Doe",
    dateOfBirth: "1970-01-01T00:00:00",
    siteId: "ms-1",
    siteName: "General",
    statusId: "st-1",
    statusName: "Enrolled",
    enrollmentDate: "2026-05-12T00:00:00",
  },
  {
    subjectId: "uuid-2",
    subjectIdentifier: "102-002",
    firstName: "Sam",
    lastName: "Roe",
    dateOfBirth: "1980-02-02T00:00:00",
    siteId: "ms-2",
    siteName: "Memorial",
    statusId: "st-2",
    statusName: "Screen Failure",
    enrollmentDate: null,
  },
];

// One row per (visit instance × form), keyed by collectionPointId.
const medrioVisitsBySubject: Record<string, unknown[]> = {
  "uuid-1": [
    {
      collectionPointId: "cp-1",
      visitId: "v-1",
      visitName: "Screening",
      visitSequenceNumber: 1,
      formId: "f-1",
      formName: "Demographics",
      dataEntered: true,
      locked: true,
      isMonitored: true,
      status: "some-free-string",
    },
    {
      collectionPointId: "cp-2",
      visitId: "v-1",
      visitName: "Screening",
      visitSequenceNumber: 1,
      formId: "f-2",
      formName: "Vitals",
      dataEntered: true,
      locked: false,
      isMonitored: null,
      status: "some-free-string",
    },
    {
      collectionPointId: "cp-3",
      visitId: "v-2",
      visitName: "Cycle 1",
      visitSequenceNumber: 1,
      formId: "f-2",
      formName: "Vitals",
      dataEntered: false,
      locked: false,
      isMonitored: null,
      status: "some-free-string",
    },
  ],
  "uuid-2": [
    {
      collectionPointId: "cp-4",
      visitId: "v-1",
      visitName: "Screening",
      visitSequenceNumber: 1,
      formId: "f-1",
      formName: "Demographics",
      dataEntered: false,
      locked: false,
      isMonitored: null,
      status: "some-free-string",
    },
  ],
};

function fakeMedrioFetch(): typeof fetch {
  return (async (url: URL | RequestInfo, init?: RequestInit) => {
    const u = new URL(url.toString());
    const respond = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (u.pathname === "/Oauth/token" && init?.method === "POST") {
      return respond({
        accessToken: "medrio-access-token",
        expiresIn: 3600,
        tokenType: "Bearer",
        userId: "u-1",
        userName: "api-user",
      });
    }
    if (u.pathname === "/api/study/med-study-1/site") return respond(medrioEnvelope(medrioSites));
    if (u.pathname === "/api/study/med-study-1/subject") {
      return respond(medrioEnvelope(medrioSubjects));
    }
    const visit = u.pathname.match(/^\/api\/study\/med-study-1\/subject\/([^/]+)\/visit$/);
    if (visit) return respond(medrioEnvelope(medrioVisitsBySubject[visit[1]!] ?? []));
    if (u.pathname === "/api/study/denied-study/subject") {
      return respond({
        processedSuccessfully: false,
        processMessage: "Study access denied",
        response: null,
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("medrio adapter (recorded fixtures, ADR-0017)", () => {
  const adapter = createMedrioAdapter(fakeMedrioFetch());
  const config = {
    baseUrl: "https://connectapi.medrio.example/",
    usernameEnv: "DMOPS_TEST_MEDRIO_USERNAME",
    passwordEnv: "DMOPS_TEST_MEDRIO_PASSWORD",
    customerApiKeyEnv: "DMOPS_TEST_MEDRIO_KEY",
    statusMap: { Enrolled: "enrolled", "Screen Failure": "screen_failed" },
  };
  const setEnv = () => {
    process.env.DMOPS_TEST_MEDRIO_USERNAME = "api-user";
    process.env.DMOPS_TEST_MEDRIO_PASSWORD = "api-password";
    process.env.DMOPS_TEST_MEDRIO_KEY = "tenant-key";
  };

  it("maps subjects through the study-configured statusMap and never emits PII (DM-P1)", async () => {
    setEnv();
    const result = await adapter.extract({
      sourceStudyKey: "med-study-1",
      frames: ["subjects"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.row_counts).toEqual({ subjects: 2 });
    // Exact equality: the fixture's firstName/lastName/dateOfBirth never
    // reach the frame.
    expect(result.frames.subjects).toEqual([
      {
        subject_key: "101-001",
        site_key: "101", // derived: siteId → siteNumber via the site listing
        status: "enrolled",
        enrolled_date: "2026-05-12", // derived: date part, timezone undeclared
      },
      { subject_key: "102-002", site_key: "102", status: "screen_failed", enrolled_date: null },
    ]);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dedupes visit instances and derives page status without claiming complete (DM-P1)", async () => {
    setEnv();
    const result = await adapter.extract({
      sourceStudyKey: "med-study-1",
      frames: ["visits", "pages"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.row_counts).toEqual({ visits: 3, pages: 4 });
    expect(result.frames.visits).toEqual([
      { subject_key: "101-001", visit_key: "Screening#1", visit_date: null, occurred: true },
      { subject_key: "101-001", visit_key: "Cycle 1#1", visit_date: null, occurred: false },
      { subject_key: "102-002", visit_key: "Screening#1", visit_date: null, occurred: false },
    ]);
    expect(result.frames.pages).toEqual([
      {
        subject_key: "101-001",
        visit_key: "Screening#1",
        form_key: "Demographics",
        status: "locked",
        first_entered_at: null, // unsupported: the API has no entry timestamp
        sdv_status: null, // unsupported: isMonitored ≠ documented SDV
      },
      {
        subject_key: "101-001",
        visit_key: "Screening#1",
        form_key: "Vitals",
        status: "in_progress", // dataEntered, but complete is never claimed
        first_entered_at: null,
        sdv_status: null,
      },
      {
        subject_key: "101-001",
        visit_key: "Cycle 1#1",
        form_key: "Vitals",
        status: "not_started",
        first_entered_at: null,
        sdv_status: null,
      },
      {
        subject_key: "102-002",
        visit_key: "Screening#1",
        form_key: "Demographics",
        status: "not_started",
        first_entered_at: null,
        sdv_status: null,
      },
    ]);
  });

  it("fails loudly on a subject status with no statusMap entry (ADR-0017)", async () => {
    setEnv();
    await expect(
      adapter.extract({
        sourceStudyKey: "med-study-1",
        frames: ["subjects"],
        config: { ...config, statusMap: { Enrolled: "enrolled" } },
      }),
    ).rejects.toThrow(/Screen Failure/);
  });

  it("surfaces the envelope's processMessage when a call is not processed", async () => {
    setEnv();
    await expect(
      adapter.extract({ sourceStudyKey: "denied-study", frames: ["subjects"], config }),
    ).rejects.toThrow(/Study access denied/);
  });

  it("declares queries unsupported — the public Medrio API has no query surface (DM-P1: no silent approximation)", async () => {
    setEnv();
    expect(adapter.capabilities().frames.queries?.supported).toBe(false);
    await expect(
      adapter.extract({ sourceStudyKey: "med-study-1", frames: ["queries"], config }),
    ).rejects.toThrow(/unsupported/);
  });

  it("fails with an actionable message when a credential env var is missing", async () => {
    setEnv();
    process.env.DMOPS_TEST_MEDRIO_PASSWORD = "";
    await expect(
      adapter.extract({ sourceStudyKey: "med-study-1", frames: ["subjects"], config }),
    ).rejects.toThrow(/DMOPS_TEST_MEDRIO_PASSWORD/);
  });
});

// Recorded response fixtures: ODM shapes per Medidata's own open-source
// rwslib audit parser (github.com/mdsol/rwslib, extras/audit_event, master
// @ 2026-07-31) and the rwslib-documented subjects sample — see the adapter
// header (ADR-0017). No live Rave in CI — the mapping is what's under test.
const raveOdmOpen = `<?xml version="1.0" encoding="UTF-8"?>
<ODM xmlns="http://www.cdisc.org/ns/odm/v1.3" xmlns:mdsol="http://www.mdsol.com/ns/odm/metadata" FileType="Transactional">`;

// Audit tape page 1 (startid 1): subject creation, a first entry (with an
// offset-less DateTimeStamp), and a query opening.
const raveAuditPage1 = `${raveOdmOpen}
  <ClinicalData StudyOID="Mediflex(Prod)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="SubjectCreated">
    <SubjectData SubjectKey="1001" TransactionType="Upsert">
      <AuditRecord>
        <UserRef UserOID="cra.jones"/>
        <LocationRef LocationOID="101"/>
        <DateTimeStamp>2026-05-12T08:00:00Z</DateTimeStamp>
        <SourceID>9001</SourceID>
      </AuditRecord>
    </SubjectData>
  </ClinicalData>
  <ClinicalData StudyOID="Mediflex(Prod)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="Entered">
    <SubjectData SubjectKey="1001" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_DM" mdsol:DataPageName="Demographics">
          <ItemGroupData ItemGroupOID="IG_DM" ItemGroupRepeatKey="1">
            <ItemData ItemOID="DM.BRTHDAT" Value="1970-01-01">
              <AuditRecord>
                <UserRef UserOID="site.coordinator"/>
                <LocationRef LocationOID="101"/>
                <DateTimeStamp>2026-06-01T09:00:00</DateTimeStamp>
                <SourceID>9002</SourceID>
              </AuditRecord>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
  <ClinicalData StudyOID="Mediflex(Prod)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="QueryOpen">
    <SubjectData SubjectKey="1001" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_DM" mdsol:DataPageName="Demographics">
          <ItemGroupData ItemGroupOID="IG_DM" ItemGroupRepeatKey="1">
            <ItemData ItemOID="DM.BRTHDAT">
              <AuditRecord>
                <UserRef UserOID="cra.jones"/>
                <LocationRef LocationOID="101"/>
                <DateTimeStamp>2026-06-02T10:00:00Z</DateTimeStamp>
                <SourceID>9003</SourceID>
              </AuditRecord>
              <mdsol:Query QueryRepeatKey="55" Status="Open" Recipient="Site from CRA"/>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;

// Audit tape page 2 (startid 4): the query is answered then closed, a second
// subject enters data, and a second query stays open.
const raveAuditPage2 = `${raveOdmOpen}
  <ClinicalData StudyOID="Mediflex(Prod)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="QueryAnswer">
    <SubjectData SubjectKey="1001" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_DM" mdsol:DataPageName="Demographics">
          <ItemGroupData ItemGroupOID="IG_DM" ItemGroupRepeatKey="1">
            <ItemData ItemOID="DM.BRTHDAT">
              <AuditRecord>
                <UserRef UserOID="site.coordinator"/>
                <LocationRef LocationOID="101"/>
                <DateTimeStamp>2026-06-04T08:00:00Z</DateTimeStamp>
                <SourceID>9004</SourceID>
              </AuditRecord>
              <mdsol:Query QueryRepeatKey="55" Status="Answered" Response="Corrected"/>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
  <ClinicalData StudyOID="Mediflex(Prod)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="QueryClose">
    <SubjectData SubjectKey="1001" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_DM" mdsol:DataPageName="Demographics">
          <ItemGroupData ItemGroupOID="IG_DM" ItemGroupRepeatKey="1">
            <ItemData ItemOID="DM.BRTHDAT">
              <AuditRecord>
                <UserRef UserOID="cra.jones"/>
                <LocationRef LocationOID="101"/>
                <DateTimeStamp>2026-06-06T10:00:00Z</DateTimeStamp>
                <SourceID>9005</SourceID>
              </AuditRecord>
              <mdsol:Query QueryRepeatKey="55" Status="Closed"/>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
  <ClinicalData StudyOID="Mediflex(Prod)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="Entered">
    <SubjectData SubjectKey="1002" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_VS" mdsol:DataPageName="Vitals">
          <ItemGroupData ItemGroupOID="IG_VS" ItemGroupRepeatKey="1">
            <ItemData ItemOID="VS.SYSBP" Value="120">
              <AuditRecord>
                <UserRef UserOID="site.coordinator"/>
                <LocationRef LocationOID="102"/>
                <DateTimeStamp>2026-06-09T09:00:00Z</DateTimeStamp>
                <SourceID>9006</SourceID>
              </AuditRecord>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
  <ClinicalData StudyOID="Mediflex(Prod)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="QueryOpen">
    <SubjectData SubjectKey="1002" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_VS" mdsol:DataPageName="Vitals">
          <ItemGroupData ItemGroupOID="IG_VS" ItemGroupRepeatKey="1">
            <ItemData ItemOID="VS.SYSBP">
              <AuditRecord>
                <UserRef UserOID="system"/>
                <LocationRef LocationOID="102"/>
                <DateTimeStamp>2026-06-10T10:00:00Z</DateTimeStamp>
                <SourceID>9007</SourceID>
              </AuditRecord>
              <mdsol:Query QueryRepeatKey="56" Status="Open" Recipient="Site from System"/>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;

// A status outside the conservative canonicalization — the vocabulary is not
// publicly enumerated, so the adapter must fail loudly (ADR-0017).
const raveAuditUnknownStatus = `${raveOdmOpen}
  <ClinicalData StudyOID="Mediflex(Weird)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="QueryForward">
    <SubjectData SubjectKey="2001" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_DM">
          <ItemGroupData ItemGroupOID="IG_DM" ItemGroupRepeatKey="1">
            <ItemData ItemOID="DM.BRTHDAT">
              <AuditRecord>
                <UserRef UserOID="cra.jones"/>
                <LocationRef LocationOID="101"/>
                <DateTimeStamp>2026-06-02T10:00:00Z</DateTimeStamp>
                <SourceID>9101</SourceID>
              </AuditRecord>
              <mdsol:Query QueryRepeatKey="77" Status="Forwarded"/>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;

// Subjects listing per the rwslib-documented sample: SubjectData with a
// SiteRef; mdsol:Status carries the workflow status (see adapter header).
const raveSubjects = `${raveOdmOpen}
  <ClinicalData StudyOID="Mediflex(Prod)" MetaDataVersionOID="1">
    <SubjectData SubjectKey="1001" mdsol:Status="Enrolled">
      <SiteRef LocationOID="101"/>
    </SubjectData>
    <SubjectData SubjectKey="1002" mdsol:Status="Screen Failure">
      <SiteRef LocationOID="102"/>
    </SubjectData>
  </ClinicalData>
</ODM>`;

const raveSubjectsNoStatus = `${raveOdmOpen}
  <ClinicalData StudyOID="Mediflex(NoStatus)" MetaDataVersionOID="1">
    <SubjectData SubjectKey="3001">
      <SiteRef LocationOID="101"/>
    </SubjectData>
  </ClinicalData>
</ODM>`;

// A study whose build carries a visit-date CRF item (ADR-0018): subject 1001
// enters DM.VISDAT and later corrects it (the tape is chronological, so the
// correction must win); subject 1002 never enters it.
const raveAuditDated = `${raveOdmOpen}
  <ClinicalData StudyOID="Mediflex(Dated)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="Entered">
    <SubjectData SubjectKey="1001" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_DM" mdsol:DataPageName="Demographics">
          <ItemGroupData ItemGroupOID="IG_DM" ItemGroupRepeatKey="1">
            <ItemData ItemOID="DM.VISDAT" Value="01 Jun 2026">
              <AuditRecord>
                <UserRef UserOID="site.coordinator"/>
                <LocationRef LocationOID="101"/>
                <DateTimeStamp>2026-06-01T09:00:00Z</DateTimeStamp>
                <SourceID>9201</SourceID>
              </AuditRecord>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
  <ClinicalData StudyOID="Mediflex(Dated)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="Entered">
    <SubjectData SubjectKey="1001" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_DM" mdsol:DataPageName="Demographics">
          <ItemGroupData ItemGroupOID="IG_DM" ItemGroupRepeatKey="1">
            <ItemData ItemOID="DM.VISDAT" Value="02 Jun 2026">
              <AuditRecord>
                <UserRef UserOID="site.coordinator"/>
                <LocationRef LocationOID="101"/>
                <DateTimeStamp>2026-06-05T10:00:00Z</DateTimeStamp>
                <SourceID>9202</SourceID>
              </AuditRecord>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
  <ClinicalData StudyOID="Mediflex(Dated)" MetaDataVersionOID="1" mdsol:AuditSubCategoryName="Entered">
    <SubjectData SubjectKey="1002" TransactionType="Upsert">
      <StudyEventData StudyEventOID="VISIT_SCREEN">
        <FormData FormOID="FORM_VS" mdsol:DataPageName="Vitals">
          <ItemGroupData ItemGroupOID="IG_VS" ItemGroupRepeatKey="1">
            <ItemData ItemOID="VS.SYSBP" Value="118">
              <AuditRecord>
                <UserRef UserOID="site.coordinator"/>
                <LocationRef LocationOID="102"/>
                <DateTimeStamp>2026-06-09T09:00:00Z</DateTimeStamp>
                <SourceID>9203</SourceID>
              </AuditRecord>
            </ItemData>
          </ItemGroupData>
        </FormData>
      </StudyEventData>
    </SubjectData>
  </ClinicalData>
</ODM>`;

function fakeRaveFetch(): typeof fetch {
  return (async (url: URL | RequestInfo) => {
    const u = new URL(url.toString());
    const respond = (body: string, headers: Record<string, string> = {}) =>
      new Response(body, { status: 200, headers: { "content-type": "text/xml", ...headers } });
    if (u.pathname === "/RaveWebServices/datasets/ClinicalAuditRecords.odm") {
      const studyOid = u.searchParams.get("studyoid");
      if (studyOid === "Mediflex(Weird)") return respond(raveAuditUnknownStatus);
      if (studyOid === "Mediflex(Dated)") return respond(raveAuditDated);
      if (studyOid !== "Mediflex(Prod)") return new Response("not found", { status: 404 });
      // The tape pages: startid 1 links to startid 4 via the Link header.
      if (u.searchParams.get("startid") === "1") {
        return respond(raveAuditPage1, {
          link: `<${u.origin}/RaveWebServices/datasets/ClinicalAuditRecords.odm?studyoid=Mediflex%28Prod%29&startid=4&per_page=100>; rel="next"`,
        });
      }
      return respond(raveAuditPage2);
    }
    if (u.pathname === "/RaveWebServices/studies/Mediflex(Prod)/subjects") {
      return respond(raveSubjects);
    }
    if (u.pathname === "/RaveWebServices/studies/Mediflex(NoStatus)/subjects") {
      return respond(raveSubjectsNoStatus);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("rave adapter (recorded fixtures, ADR-0017)", () => {
  const adapter = createRaveAdapter(fakeRaveFetch());
  const config = {
    baseUrl: "https://rave.example/",
    usernameEnv: "DMOPS_TEST_RAVE_USERNAME",
    passwordEnv: "DMOPS_TEST_RAVE_PASSWORD",
    statusMap: { Enrolled: "enrolled", "Screen Failure": "screen_failed" },
  };
  const setEnv = () => {
    process.env.DMOPS_TEST_RAVE_USERNAME = "rws-user";
    process.env.DMOPS_TEST_RAVE_PASSWORD = "rws-password";
  };

  it("reconstructs query lifecycles from the audit tape, following the Link cursor", async () => {
    setEnv();
    const result = await adapter.extract({
      sourceStudyKey: "Mediflex(Prod)",
      frames: ["queries"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.row_counts).toEqual({ queries: 2 });
    expect(result.frames.queries).toEqual([
      {
        source_query_id: "1001|VISIT_SCREEN|FORM_DM|IG_DM|1|DM.BRTHDAT|55",
        site_key: "101",
        subject_key: "1001",
        form_key: "FORM_DM",
        origin: null, // unsupported: attribution not publicly confirmable
        status: "closed",
        opened_at: "2026-06-02T10:00:00Z",
        first_response_at: "2026-06-04T08:00:00Z",
        closed_at: "2026-06-06T10:00:00Z",
      },
      {
        source_query_id: "1002|VISIT_SCREEN|FORM_VS|IG_VS|1|VS.SYSBP|56",
        site_key: "102",
        subject_key: "1002",
        form_key: "FORM_VS",
        origin: null,
        status: "open",
        opened_at: "2026-06-10T10:00:00Z",
        first_response_at: null, // never answered → null, not a guess (DM-P1)
        closed_at: null,
      },
    ]);
    // Same tape, same rows, same checksum (extract provenance).
    const again = await adapter.extract({
      sourceStudyKey: "Mediflex(Prod)",
      frames: ["queries"],
      config,
    });
    expect(again.checksum).toBe(result.checksum);
  });

  it("derives visits and pages from Entered audit events, stamping undeclared offsets as Z (declared assumption, DM-P1)", async () => {
    setEnv();
    const result = await adapter.extract({
      sourceStudyKey: "Mediflex(Prod)",
      frames: ["visits", "pages"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.row_counts).toEqual({ visits: 2, pages: 2 });
    expect(result.frames.visits).toEqual([
      { subject_key: "1001", visit_key: "VISIT_SCREEN", visit_date: null, occurred: true },
      { subject_key: "1002", visit_key: "VISIT_SCREEN", visit_date: null, occurred: true },
    ]);
    expect(result.frames.pages).toEqual([
      {
        subject_key: "1001",
        visit_key: "VISIT_SCREEN",
        form_key: "FORM_DM",
        status: "in_progress", // conservative: complete is never claimed
        first_entered_at: "2026-06-01T09:00:00Z", // offset-less fixture value, stamped Z
        sdv_status: null, // unsupported: no page-level SDV rollup
      },
      {
        subject_key: "1002",
        visit_key: "VISIT_SCREEN",
        form_key: "FORM_VS",
        status: "in_progress",
        first_entered_at: "2026-06-09T09:00:00Z",
        sdv_status: null,
      },
    ]);
  });

  it("maps the subjects listing through statusMap and SiteRef (ADR-0017)", async () => {
    setEnv();
    const result = await adapter.extract({
      sourceStudyKey: "Mediflex(Prod)",
      frames: ["subjects"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.frames.subjects).toEqual([
      { subject_key: "1001", site_key: "101", status: "enrolled", enrolled_date: null },
      { subject_key: "1002", site_key: "102", status: "screen_failed", enrolled_date: null },
    ]);
    expect(adapter.capabilities().frames.subjects?.fields.enrolled_date).toBe("unsupported");
  });

  it("fails loudly on a query status outside the public vocabulary (ADR-0017, DM-P1: no silent approximation)", async () => {
    setEnv();
    await expect(
      adapter.extract({ sourceStudyKey: "Mediflex(Weird)", frames: ["queries"], config }),
    ).rejects.toThrow(/Forwarded/);
  });

  it("fails loudly when a subject carries no readable workflow status (ADR-0017)", async () => {
    setEnv();
    await expect(
      adapter.extract({ sourceStudyKey: "Mediflex(NoStatus)", frames: ["subjects"], config }),
    ).rejects.toThrow(/no readable workflow status/);
  });

  it("declares repository frames unsupported and refuses to extract them (DM-P1: no silent approximation)", async () => {
    setEnv();
    expect(adapter.capabilities().frames.issues).toBeUndefined();
    await expect(
      adapter.extract({ sourceStudyKey: "Mediflex(Prod)", frames: ["issues"], config }),
    ).rejects.toThrow(/unsupported/);
  });

  it("fails with an actionable message when a credential env var is missing", async () => {
    setEnv();
    process.env.DMOPS_TEST_RAVE_PASSWORD = "";
    await expect(
      adapter.extract({ sourceStudyKey: "Mediflex(Prod)", frames: ["queries"], config }),
    ).rejects.toThrow(/DMOPS_TEST_RAVE_PASSWORD/);
  });

  // Per-study visit-date CRF mapping (ADR-0018).
  const datedConfig = {
    ...config,
    visitDateItem: { formOid: "FORM_DM", itemOid: "DM.VISDAT", dateFormat: "dd MMM yyyy" },
  };

  it("visit_date is derived only when config maps the study's CRF item (ADR-0018)", () => {
    expect(adapter.capabilities().frames.visits?.fields.visit_date).toBe("unsupported");
    expect(adapter.capabilities(config).frames.visits?.fields.visit_date).toBe("unsupported");
    expect(adapter.capabilities(datedConfig).frames.visits?.fields.visit_date).toBe("derived");
    // Never throws: invalid config yields the conservative posture.
    expect(adapter.capabilities({ nonsense: true }).frames.visits?.fields.visit_date).toBe(
      "unsupported",
    );
  });

  it("reads the mapped item's value off the audit tape, last observation winning (ADR-0018)", async () => {
    setEnv();
    const result = await adapter.extract({
      sourceStudyKey: "Mediflex(Dated)",
      frames: ["visits"],
      config: datedConfig,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    expect(result.frames.visits).toEqual([
      // The 05 Jun correction to 02 Jun 2026 wins over the 01 Jun entry.
      { subject_key: "1001", visit_key: "VISIT_SCREEN", visit_date: "2026-06-02", occurred: true },
      // 1002 never entered the mapped item: no date, never a guess (DM-P1).
      { subject_key: "1002", visit_key: "VISIT_SCREEN", visit_date: null, occurred: true },
    ]);
  });

  it("leaves visit_date null on the same tape when no mapping is configured (ADR-0018)", async () => {
    setEnv();
    const result = await adapter.extract({
      sourceStudyKey: "Mediflex(Dated)",
      frames: ["visits"],
      config,
    });
    expect(result.frames.visits).toEqual([
      { subject_key: "1001", visit_key: "VISIT_SCREEN", visit_date: null, occurred: true },
      { subject_key: "1002", visit_key: "VISIT_SCREEN", visit_date: null, occurred: true },
    ]);
  });

  it("fails loudly when a value does not parse under the declared dateFormat (ADR-0017/ADR-0018)", async () => {
    setEnv();
    await expect(
      adapter.extract({
        sourceStudyKey: "Mediflex(Dated)",
        frames: ["visits"],
        config: {
          ...datedConfig,
          visitDateItem: { ...datedConfig.visitDateItem, dateFormat: "yyyy-MM-dd" },
        },
      }),
    ).rejects.toThrow(/01 Jun 2026/);
  });

  // MAuth request signing (ADR-0021). Key material is the vendored vendor
  // conformance suite's fixed pair — protocol conformance itself is pinned
  // case-by-case in rave/mauth.test.ts; these tests cover the adapter wiring.
  const mauthSuite = "fixtures/mauth-protocol-test-suite";
  const mauthConfig = {
    baseUrl: "https://rave.example/",
    mauth: {
      appUuid: "836a454e-7f14-4192-8f5a-2a9d3d66f70c",
      privateKeyEnv: "DMOPS_TEST_RAVE_MAUTH_KEY",
    },
    statusMap: { Enrolled: "enrolled", "Screen Failure": "screen_failed" },
  };
  const setMauthEnv = () => {
    process.env.DMOPS_TEST_RAVE_MAUTH_KEY = readFileSync(
      join(mauthSuite, "signing-params/rsa-key"),
      "utf8",
    );
  };

  it("signs every request — Link pages included — with verifiable V1+V2 headers (ADR-0021)", async () => {
    setMauthEnv();
    const publicKey = readFileSync(join(mauthSuite, "signing-params/rsa-key-pub"), "utf8");
    const inner = fakeRaveFetch();
    const seen: { url: URL; headers: Record<string, string> }[] = [];
    const capturing = (async (url: URL | RequestInfo, init?: RequestInit) => {
      seen.push({
        url: new URL(url.toString()),
        headers: { ...((init?.headers ?? {}) as Record<string, string>) },
      });
      return inner(url as URL, init);
    }) as typeof fetch;
    const mauthAdapter = createRaveAdapter(capturing);

    const result = await mauthAdapter.extract({
      sourceStudyKey: "Mediflex(Prod)",
      frames: ["queries"],
      config: mauthConfig,
    });
    // Same tape, same rows: auth mode changes authorization, never data.
    expect(result.row_counts).toEqual({ queries: 2 });
    expect(seen).toHaveLength(2); // audit page 1 + followed Link page

    for (const { url, headers } of seen) {
      expect(headers.authorization).toBeUndefined();
      const time = headers["X-MWS-Time"] as string;
      expect(time).toMatch(/^\d+$/);
      expect(headers["MCC-Time"]).toBe(time);
      const signInput = {
        verb: "GET",
        path: url.pathname,
        query: url.search.slice(1),
        appUuid: mauthConfig.mauth.appUuid,
        privateKey: "", // sts construction does not use the key
        time,
      };
      // V1: public-decrypt of the signature recovers the SHA-512 hexdigest.
      const v1 = headers["X-MWS-Authentication"] as string;
      expect(v1).toMatch(new RegExp(`^MWS ${mauthConfig.mauth.appUuid}:`));
      const v1Sig = Buffer.from(v1.split(":")[1] as string, "base64");
      expect(
        publicDecrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, v1Sig).toString(
          "utf8",
        ),
      ).toBe(createHash("sha512").update(stringToSignV1(signInput)).digest("hex"));
      // V2: standard RSA-SHA512 verification over the V2 string_to_sign.
      const v2 = headers["MCC-Authentication"] as string;
      expect(v2).toMatch(new RegExp(`^MWSV2 ${mauthConfig.mauth.appUuid}:.*;$`));
      const v2Sig = Buffer.from((v2.split(":")[1] as string).replace(/;$/, ""), "base64");
      expect(
        cryptoVerify("sha512", Buffer.from(stringToSignV2(signInput), "utf8"), publicKey, v2Sig),
      ).toBe(true);
    }
  });

  it("capability posture is independent of auth mode (ADR-0021)", () => {
    expect(adapter.capabilities(mauthConfig)).toEqual(adapter.capabilities(config));
  });

  it("refuses a config carrying both auth modes, or neither (ADR-0021)", async () => {
    setEnv();
    setMauthEnv();
    await expect(
      adapter.extract({
        sourceStudyKey: "Mediflex(Prod)",
        frames: ["queries"],
        config: { ...config, mauth: mauthConfig.mauth },
      }),
    ).rejects.toThrow(/exactly one auth mode/);
    await expect(
      adapter.extract({
        sourceStudyKey: "Mediflex(Prod)",
        frames: ["queries"],
        config: { baseUrl: config.baseUrl, statusMap: config.statusMap },
      }),
    ).rejects.toThrow(/no auth mode/);
  });

  it("fails with an actionable message when the private-key env var is missing", async () => {
    process.env.DMOPS_TEST_RAVE_MAUTH_KEY = "";
    await expect(
      adapter.extract({
        sourceStudyKey: "Mediflex(Prod)",
        frames: ["queries"],
        config: mauthConfig,
      }),
    ).rejects.toThrow(/DMOPS_TEST_RAVE_MAUTH_KEY/);
  });
});

// Recorded response fixtures: auth/query/pagination shapes per the public
// Vault API reference (developer.veevavault.com/api/25.1, VQL guide at
// developer.veevavault.com/vql — accessed 2026-08-03), training_assignment__v
// fields per Veeva's Vault Training help — see the adapter header
// (ADR-0020). No live Vault in CI — the mapping is what's under test.
const vaultPage1 = {
  responseStatus: "SUCCESS",
  responseDetails: {
    pagesize: 3,
    pageoffset: 0,
    size: 3,
    total: 4,
    next_page: "/api/v25.1/query/8dd0c8/page/2",
  },
  data: [
    {
      id: "VTA-000001",
      state__v: "assigned_state__v",
      due_date__v: "2026-08-15",
      completion_date__v: null,
      training_requirement__v: "TR-0000012",
      course_title: "GCP Refresher 2026",
      person_email: "coordinator@site101.example",
      person_name: "Pat Coordinator",
    },
    {
      id: "VTA-000002",
      state__v: "completed_state__v",
      due_date__v: "2026-06-30",
      completion_date__v: "2026-06-12T09:15:00.000Z",
      training_requirement__v: "TR-0000012",
      course_title: "GCP Refresher 2026",
      person_email: "cra@cro.example",
      person_name: "Sam Monitor",
    },
    {
      id: "VTA-000003",
      state__v: "cancelled_state__v",
      due_date__v: "2026-05-01",
      completion_date__v: null,
      training_requirement__v: "TR-0000009",
      course_title: "Retired IRT Module",
      person_email: "coordinator@site101.example",
      person_name: "Pat Coordinator",
    },
  ],
};

const vaultPage2 = {
  responseStatus: "SUCCESS",
  responseDetails: { pagesize: 3, pageoffset: 3, size: 1, total: 4 },
  data: [
    {
      id: "VTA-000004",
      state__v: "assigned_state__v",
      due_date__v: null,
      completion_date__v: null,
      training_requirement__v: "TR-0000031",
      course_title: "Protocol Amendment 2 Training",
      person_email: "dm@cro.example",
      person_name: null,
    },
  ],
};

function fakeVaultFetch(): typeof fetch {
  return (async (url: URL | RequestInfo, init?: RequestInit) => {
    const u = new URL(url.toString());
    const respond = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    if (u.pathname === "/api/v25.1/auth" && init?.method === "POST") {
      return respond({ responseStatus: "SUCCESS", sessionId: "vault-session-id", userId: 100 });
    }
    const headers = init?.headers as Record<string, string> | undefined;
    if (headers?.authorization !== "vault-session-id") {
      return new Response("unauthorized", { status: 401 });
    }
    if (u.pathname === "/api/v25.1/query/8dd0c8/page/2") return respond(vaultPage2);
    if (u.pathname === "/api/v25.1/query" && init?.method === "POST") {
      const q = (init.body as URLSearchParams).get("q") ?? "";
      if (q.includes("'study-denied'")) {
        return respond({
          responseStatus: "FAILURE",
          errors: [
            {
              type: "INSUFFICIENT_ACCESS",
              message: "User does not have query permission on [training_assignment__v]",
            },
          ],
        });
      }
      if (q.includes("'study-noemail'")) {
        return respond({
          responseStatus: "SUCCESS",
          responseDetails: {},
          data: [
            {
              id: "VTA-000099",
              state__v: "assigned_state__v",
              due_date__v: null,
              completion_date__v: null,
              training_requirement__v: "TR-0000031",
              course_title: "Protocol Amendment 2 Training",
              person_email: null,
              person_name: null,
            },
          ],
        });
      }
      if (q.includes("WHERE study__v = 'study-1'")) return respond(vaultPage1);
      // No WHERE clause: the whole-vault posture (no studyField configured).
      if (!q.includes(" WHERE ")) return respond(vaultPage2);
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("vault-training adapter (recorded fixtures, ADR-0020)", () => {
  const adapter = createVaultTrainingAdapter(fakeVaultFetch());
  const config = {
    baseUrl: "https://mytenant.veevavault.example/",
    usernameEnv: "DMOPS_TEST_VAULT_USERNAME",
    passwordEnv: "DMOPS_TEST_VAULT_PASSWORD",
    learnerEmailPath: "learner__vr.email__sys",
    learnerNamePath: "learner__vr.name__v",
    studyField: "study__v",
    stateMap: {
      assigned_state__v: "required",
      completed_state__v: "required",
      cancelled_state__v: "excluded",
    },
  };
  const setEnv = () => {
    process.env.DMOPS_TEST_VAULT_USERNAME = "integration-user";
    process.env.DMOPS_TEST_VAULT_PASSWORD = "integration-password";
  };

  it("maps the transcript through the tenant stateMap, following next_page (ADR-0020)", async () => {
    setEnv();
    const result = await adapter.extract({
      sourceStudyKey: "study-1",
      frames: ["training_records"],
      config,
    });
    expect(() => validateExtraction(result)).not.toThrow();
    // 4 assignments on the tape; the cancelled one is excluded by stateMap —
    // a withdrawn requirement is not a training gap.
    expect(result.row_counts).toEqual({ training_records: 3 });
    expect(result.frames.training_records).toEqual([
      {
        person_key: "coordinator@site101.example",
        person_name: "Pat Coordinator",
        course_key: "TR-0000012",
        course_title: "GCP Refresher 2026",
        due_date: "2026-08-15",
        completed_date: null,
        expires_date: null, // derived: recurrence reissues, completions never expire
      },
      {
        person_key: "cra@cro.example",
        person_name: "Sam Monitor",
        course_key: "TR-0000012",
        course_title: "GCP Refresher 2026",
        due_date: "2026-06-30",
        completed_date: "2026-06-12", // date part; time semantics undeclared
        expires_date: null,
      },
      {
        person_key: "dm@cro.example",
        person_name: null,
        course_key: "TR-0000031",
        course_title: "Protocol Amendment 2 Training",
        due_date: null, // undated: required now (ADR-0013)
        completed_date: null,
        expires_date: null,
      },
    ]);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it("omitting studyField mirrors the whole vault — the org-wide training posture (ADR-0020)", async () => {
    setEnv();
    const { studyField, ...orgWide } = config;
    const result = await adapter.extract({
      sourceStudyKey: "study-1",
      frames: ["training_records"],
      config: orgWide,
    });
    expect(result.row_counts).toEqual({ training_records: 1 });
  });

  it("fails loudly on a lifecycle state with no stateMap entry (ADR-0020)", async () => {
    setEnv();
    await expect(
      adapter.extract({
        sourceStudyKey: "study-1",
        frames: ["training_records"],
        config: {
          ...config,
          stateMap: { assigned_state__v: "required", completed_state__v: "required" },
        },
      }),
    ).rejects.toThrow(/cancelled_state__v/);
  });

  it("fails loudly when the email path resolves nothing — never an anonymous transcript row (ADR-0020)", async () => {
    setEnv();
    await expect(
      adapter.extract({ sourceStudyKey: "study-noemail", frames: ["training_records"], config }),
    ).rejects.toThrow(/learner__vr\.email__sys/);
  });

  it("surfaces Vault's own error detail when a query is not successful", async () => {
    setEnv();
    await expect(
      adapter.extract({ sourceStudyKey: "study-denied", frames: ["training_records"], config }),
    ).rejects.toThrow(/INSUFFICIENT_ACCESS/);
  });

  it("declares only the transcript — access_grants audits the wrong door (ADR-0020, DM-P1)", async () => {
    setEnv();
    const caps = adapter.capabilities();
    expect(Object.keys(caps.frames)).toEqual(["training_records"]);
    expect(caps.frames.training_records?.fields.expires_date).toBe("derived");
    await expect(
      adapter.extract({ sourceStudyKey: "study-1", frames: ["access_grants"], config }),
    ).rejects.toThrow(/unsupported/);
  });

  it("refuses a source_study_key it would have to escape into VQL", async () => {
    setEnv();
    await expect(
      adapter.extract({ sourceStudyKey: "study-o'brien", frames: ["training_records"], config }),
    ).rejects.toThrow(/refuses to escape/);
  });

  it("fails with an actionable message when a credential env var is missing", async () => {
    setEnv();
    process.env.DMOPS_TEST_VAULT_PASSWORD = "";
    await expect(
      adapter.extract({ sourceStudyKey: "study-1", frames: ["training_records"], config }),
    ).rejects.toThrow(/DMOPS_TEST_VAULT_PASSWORD/);
  });
});
