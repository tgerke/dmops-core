/**
 * API role-scoping and write-path tests against the seeded demo data
 * (run `pnpm db:seed` first; ids regenerate per seed, so studies are looked
 * up by protocol number).
 */
import { appDatabaseUrl, createDb, loadEnv } from "@dmops/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

loadEnv();
process.env.DMOPS_AUTH_MODE = "dev";

// Same posture as production: the API runs as the DML-only dmops_app role.
const { sql } = createDb(appDatabaseUrl());
const { sql: owner } = createDb();
const app = buildApp(sql);
afterAll(async () => {
  await sql.end();
  await owner.end();
});

let study1 = "";
let study2 = "";
beforeAll(async () => {
  const rows = await sql`SELECT id, protocol_number FROM study ORDER BY protocol_number`;
  study1 = rows.find((r) => r.protocol_number === "DMOPS-001")?.id as string;
  study2 = rows.find((r) => r.protocol_number === "DMOPS-002")?.id as string;
  expect(study1).toBeTruthy();
  expect(study2).toBeTruthy();
});

const get = (path: string, token: string) =>
  app.request(path, { headers: { authorization: `Bearer ${token}` } });
const patch = (path: string, token: string, body: unknown) =>
  app.request(path, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("authentication", () => {
  it("rejects missing and unknown tokens", async () => {
    expect((await app.request("/studies")).status).toBe(401);
    expect((await get("/studies", "wrong-token")).status).toBe(401);
  });

  it("health is public and reports a verified audit chain", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.audit_chain_verified).toBe(true);
    expect(body.migrations).toBe(3);
  });
});

describe("role-scoped views over one set of facts (DM-P5)", () => {
  it("DM-P5: qa sees the whole portfolio; the sponsor seat sees only its study", async () => {
    const qa = await (await get("/studies", "dev-qa-token")).json();
    expect(qa.map((s: { protocol_number: string }) => s.protocol_number)).toEqual([
      "DMOPS-001",
      "DMOPS-002",
    ]);
    const sponsor = await (await get("/studies", "dev-sponsor-token")).json();
    expect(sponsor.map((s: { protocol_number: string }) => s.protocol_number)).toEqual([
      "DMOPS-001",
    ]);
    expect((await get(`/studies/${study2}/milestones`, "dev-sponsor-token")).status).toBe(403);
  });

  it("DM-P5: the sponsor serialization carries no blocker notes; the DM lead's does", async () => {
    const lead = await (await get(`/studies/${study1}/milestones`, "dev-dmlead-token")).json();
    const blocked = lead.milestones.find((m: { status: string }) => m.status === "blocked");
    expect(blocked.code).toBe("CLOSE.SAE");
    expect(blocked.blocker_note).toMatch(/SAE discrepancies/);

    const sponsor = await (await get(`/studies/${study1}/milestones`, "dev-sponsor-token")).json();
    const sponsorBlocked = sponsor.milestones.find(
      (m: { status: string }) => m.status === "blocked",
    );
    // Same fact (the milestone is blocked), curated serialization: the
    // internal note is absent, not blanked.
    expect(sponsorBlocked.status).toBe("blocked");
    expect("blocker_note" in sponsorBlocked).toBe(false);
  });

  it("DM-P6: the board is one read; planned/forecast/actual arrive as the triple, never collapsed", async () => {
    const res = await get(`/studies/${study1}/milestones`, "dev-clinops-token");
    expect(res.status).toBe(200);
    const body = await res.json();
    const done = body.milestones.find((m: { code: string }) => m.code === "SPEC.DMP.APPROVED");
    expect(done.baseline_date).toBe("2026-01-26");
    expect(done.planned_date).toBe("2026-01-26");
    expect(done.actual_date).toBe("2026-01-30");
    expect(done.actual_slip_days).toBe(4);
  });
});

describe("milestone writes (ADR-0003, ADR-0008)", () => {
  it("read-only roles cannot write: clinops and sponsor get 403", async () => {
    const body = { status: "in_progress" };
    expect(
      (await patch(`/studies/${study1}/milestones/CLOSE.SDV`, "dev-clinops-token", body)).status,
    ).toBe(403);
    expect(
      (await patch(`/studies/${study1}/milestones/CLOSE.SDV`, "dev-sponsor-token", body)).status,
    ).toBe(403);
  });

  it("the DM lead's write lands, returns the board row, and is audit-attributed to them", async () => {
    const res = await patch(
      `/studies/${study1}/milestones/COND.INTERIM?occurrence=1`,
      "dev-dmlead-token",
      {
        status: "in_progress",
        forecast_date: "2026-09-22",
      },
    );
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.status).toBe("in_progress");
    expect(row.forecast_date).toBe("2026-09-22");
    expect(row.forecast_slip_days).toBe(7);

    const [event] = await owner`
      SELECT * FROM audit_event
      WHERE action = 'study_milestone.update' ORDER BY id DESC LIMIT 1`;
    expect(event!.actor_label).toMatch(/Maya Okafor/);
    expect(event!.before.status).toBe("not_started");
    expect(event!.after.status).toBe("in_progress");

    // restore for repeatable local runs (also audited)
    await patch(`/studies/${study1}/milestones/COND.INTERIM?occurrence=1`, "dev-dmlead-token", {
      status: "not_started",
      forecast_date: "2026-09-15",
    });
  });

  it("ADR-0008: baseline_date and planned_date are not writable through the API", async () => {
    const res = await patch(`/studies/${study1}/milestones/CLOSE.SDV`, "dev-dmlead-token", {
      baseline_date: "2027-01-01",
    });
    expect(res.status).toBe(400);
  });

  it("404s on a milestone occurrence the study does not have", async () => {
    const res = await patch(
      `/studies/${study1}/milestones/COND.AMEND?occurrence=9`,
      "dev-dmlead-token",
      {
        status: "in_progress",
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("metrics surface (DM-P1, DM-P2, DM-P3)", () => {
  it("DM-P2: every dictionary metric appears with its version and availability", async () => {
    const res = await get(`/studies/${study1}/metrics`, "dev-dmlead-token");
    const body = await res.json();
    const ids = body.metrics.map((m: { metric_id: string }) => m.metric_id).sort();
    expect(ids).toEqual(["entry_lag", "milestone_slip", "query_open_aging", "query_tat_median"]);
    for (const m of body.metrics) {
      expect(m.availability).toBe("computed");
      expect(m.latest.metric_version).toBe("1.0");
    }
  });

  it("DM-P1: a study without a source reports adapter metrics unavailable, not zero", async () => {
    const res = await get(`/studies/${study2}/metrics`, "dev-dmlead-token");
    const body = await res.json();
    const tat = body.metrics.find((m: { metric_id: string }) => m.metric_id === "query_tat_median");
    expect(tat.availability).toMatch(/^unavailable: no active study_source/);
    expect(tat.latest).toBeNull();
    const slip = body.metrics.find((m: { metric_id: string }) => m.metric_id === "milestone_slip");
    expect(slip.availability).toBe("computed");
  });

  it("DM-P3: snapshot history is served from immutable rows with extract lineage", async () => {
    const res = await get(
      `/studies/${study1}/metrics/query_tat_median/snapshots?grain=site`,
      "dev-qa-token",
    );
    const rows = await res.json();
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.metric_version).toBe("1.0");
      expect(row.grain).toBe("site");
    }
  });
});
