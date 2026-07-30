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
const post = (path: string, token: string, body: unknown) =>
  app.request(path, {
    method: "POST",
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
    expect(body.migrations).toBe(5);
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

describe("deliverable surface (ADR-0006)", () => {
  const deliverableId = async (title: string) => {
    const body = await (await get(`/studies/${study1}/deliverables`, "dev-dmlead-token")).json();
    return body.deliverables.find((d: { title: string }) => d.title === title).id as string;
  };

  it("DM-P4: deliverables serve status and an eTMF pointer, never content or signatures", async () => {
    const res = await get(`/studies/${study1}/deliverables`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliverables.length).toBe(3);
    const dmp = body.deliverables.find((d: { type: string }) => d.type === "dmp");
    expect(dmp.status).toBe("approved");
    expect(dmp.etmf_uri).toMatch(/ctms\.example\/tmf/);
    for (const d of body.deliverables) {
      expect(Object.keys(d).some((k) => /content|file|blob|body|signature|signed/.test(k))).toBe(
        false,
      );
    }
  });

  it("DM-P5: deliverable reads are row-scoped; the sponsor seat sees its study only", async () => {
    const sponsor = await get(`/studies/${study1}/deliverables`, "dev-sponsor-token");
    expect(sponsor.status).toBe(200);
    const body = await sponsor.json();
    expect(body.deliverables.length).toBe(3);
    expect(body.deliverables[0].etmf_uri).not.toBeUndefined();
    expect((await get(`/studies/${study2}/deliverables`, "dev-sponsor-token")).status).toBe(403);
    expect((await get(`/studies/${study2}/deliverables`, "dev-qa-token")).status).toBe(200);
  });

  it("DM-P6: read-only roles cannot write deliverable status; the DM lead's write is audit-attributed (ADR-0003)", async () => {
    const id = await deliverableId("SDTM Mapping Specification");
    for (const token of ["dev-clinops-token", "dev-sponsor-token"]) {
      expect(
        (await patch(`/studies/${study1}/deliverables/${id}`, token, { status: "approved" }))
          .status,
      ).toBe(403);
    }

    const res = await patch(`/studies/${study1}/deliverables/${id}`, "dev-dmlead-token", {
      status: "approved",
      approved_date: "2026-07-15",
    });
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.status).toBe("approved");
    expect(row.approved_date).toBe("2026-07-15");

    const [event] = await owner`
      SELECT * FROM audit_event
      WHERE action = 'deliverable.update' ORDER BY id DESC LIMIT 1`;
    expect(event!.actor_label).toMatch(/Maya Okafor/);
    expect(event!.before.status).toBe("in_review");
    expect(event!.after.status).toBe("approved");

    // restore for repeatable local runs (also audited)
    await patch(`/studies/${study1}/deliverables/${id}`, "dev-dmlead-token", {
      status: "in_review",
      approved_date: null,
    });
  });

  it("approving without an approved_date is rejected: approvals are dated facts (ADR-0006)", async () => {
    const id = await deliverableId("SDTM Mapping Specification");
    const res = await patch(`/studies/${study1}/deliverables/${id}`, "dev-dmlead-token", {
      status: "approved",
    });
    expect(res.status).toBe(400);
  });

  it("ADR-0006: identity fields are not writable and unknown fields are rejected", async () => {
    const id = await deliverableId("Data Management Plan");
    const res = await patch(`/studies/${study1}/deliverables/${id}`, "dev-dmlead-token", {
      title: "Renamed Plan",
    });
    expect(res.status).toBe(400);
  });
});

describe("re-baselining governance (ADR-0009, ADR-0003)", () => {
  // milestone_rebaseline is append-only, so records accumulate across local
  // runs without a re-seed; assertions are relative to the pre-test history.
  it("re-baselining is above routine edits: dm_lead, clinops, and sponsor get 403", async () => {
    const body = { planned_date: "2027-05-01", reason: "should never be applied" };
    for (const token of ["dev-dmlead-token", "dev-clinops-token", "dev-sponsor-token"]) {
      const res = await post(`/studies/${study1}/milestones/CLOSE.SDV/rebaseline`, token, body);
      expect(res.status).toBe(403);
    }
  });

  it("DM-P6: the dm_manager's re-baseline moves planned_date, never baseline_date, and both writes are audit-attributed (ADR-0003)", async () => {
    const before = await (
      await get(`/studies/${study1}/milestones/CLOSE.SDV/rebaselines`, "dev-manager-token")
    ).json();
    const n = before.length;

    const res = await post(
      `/studies/${study1}/milestones/CLOSE.SDV/rebaseline`,
      "dev-manager-token",
      {
        planned_date: "2027-05-01",
        reason: "protocol amendment 3 extends enrollment by six weeks",
        reference_uri: "https://ctms.example/tmf/amendment-3",
      },
    );
    expect(res.status).toBe(201);
    const { milestone, rebaseline } = await res.json();
    expect(milestone.planned_date).toBe("2027-05-01");
    expect(milestone.baseline_date).toBe("2027-04-12"); // survives, always
    expect(milestone.rebaseline_count).toBe(n + 1);
    expect(rebaseline.rebaseline_number).toBe(n + 1);
    expect(rebaseline.reason).toMatch(/amendment 3/);

    const events = await owner`
      SELECT * FROM audit_event
      WHERE action IN ('milestone_rebaseline.insert', 'study_milestone.update')
      ORDER BY id DESC LIMIT 2`;
    for (const event of events) {
      expect(event.actor_label).toMatch(/Daniel Reyes/);
    }
    expect(events.map((e) => e.action).sort()).toEqual([
      "milestone_rebaseline.insert",
      "study_milestone.update",
    ]);

    // restore the plan for repeatable local runs — itself a governed,
    // history-preserving re-baseline, not an edit
    const restore = await post(
      `/studies/${study1}/milestones/CLOSE.SDV/rebaseline`,
      "dev-manager-token",
      { planned_date: "2027-04-12", reason: "restore seed plan after automated test run" },
    );
    expect(restore.status).toBe(201);
  });

  it("a complete milestone cannot be re-baselined; nor can one with a throwaway reason", async () => {
    const complete = await post(
      `/studies/${study1}/milestones/SPEC.DMP.APPROVED/rebaseline`,
      "dev-manager-token",
      { planned_date: "2026-03-01", reason: "trying to rewrite finished history" },
    );
    expect(complete.status).toBe(400);

    const flimsy = await post(
      `/studies/${study1}/milestones/CLOSE.SDV/rebaseline`,
      "dev-manager-token",
      { planned_date: "2027-05-01", reason: "because" },
    );
    expect(flimsy.status).toBe(400);
  });

  it("DM-P5: re-baseline history serves dates to everyone; reasons are omitted from the sponsor serialization", async () => {
    const dm = await (
      await get(`/studies/${study1}/milestones/CLOSE.SDV/rebaselines`, "dev-dmlead-token")
    ).json();
    expect(dm.length).toBeGreaterThanOrEqual(2);
    expect(dm[0].rebaseline_number).toBe(1);
    expect(typeof dm[0].reason).toBe("string");

    const sponsor = await (
      await get(`/studies/${study1}/milestones/CLOSE.SDV/rebaselines`, "dev-sponsor-token")
    ).json();
    expect(sponsor.length).toBe(dm.length);
    for (const record of sponsor) {
      expect(record.new_planned_date).toBeTruthy();
      expect("reason" in record).toBe(false);
    }
  });

  it("404s on a milestone the study does not have", async () => {
    const res = await post(
      `/studies/${study1}/milestones/COND.AMEND/rebaseline?occurrence=9`,
      "dev-manager-token",
      { planned_date: "2027-05-01", reason: "no such occurrence to re-baseline" },
    );
    expect(res.status).toBe(404);
  });
});

describe("UAT cycles and defects (ADR-0010)", () => {
  // Cycles and defects are mutable audited rows, but created rows have no
  // DELETE path; assertions on counts are relative and a re-seed is the reset.
  const cycles = async (token = "dev-dmlead-token") =>
    (await (await get(`/studies/${study1}/uat-cycles`, token)).json()).cycles;
  const cycleByNumber = async (n: number) =>
    (await cycles()).find((c: { cycle_number: number }) => c.cycle_number === n);

  it("DM-P4: UAT serves cycle status, counts, and an evidence pointer — never scripts, screenshots, or signatures", async () => {
    const res = await get(`/studies/${study1}/uat-cycles`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    const all = (await res.json()).cycles;
    const cycle1 = all.find((c: { cycle_number: number }) => c.cycle_number === 1);
    expect(cycle1.status).toBe("complete");
    expect(cycle1.evidence_uri).toMatch(/ctms\.example\/tmf/);
    expect(cycle1.closed_defects).toBe(4);
    expect(cycle1.withdrawn_defects).toBe(1);
    expect(cycle1.open_defects).toBe(0);
    const defects = (
      await (
        await get(`/studies/${study1}/uat-cycles/${cycle1.id}/defects`, "dev-dmlead-token")
      ).json()
    ).defects;
    for (const row of [...all, ...defects]) {
      expect(
        Object.keys(row).some((k) => /content|file|blob|body|signature|signed|script_text/.test(k)),
      ).toBe(false);
    }
  });

  it("DM-P5: defect reads are row-scoped; the sponsor serialization omits resolution notes", async () => {
    const cycle1 = await cycleByNumber(1);
    const sponsor = await get(
      `/studies/${study1}/uat-cycles/${cycle1.id}/defects`,
      "dev-sponsor-token",
    );
    expect(sponsor.status).toBe(200);
    const body = await sponsor.json();
    expect(body.defects.length).toBe(5);
    for (const d of body.defects) {
      expect(d.severity).toBeTruthy();
      // Curated serialization: the internal note is absent, not blanked.
      expect("resolution_note" in d).toBe(false);
    }
    expect((await get(`/studies/${study2}/uat-cycles`, "dev-sponsor-token")).status).toBe(403);
    const qa = await get(`/studies/${study2}/uat-cycles`, "dev-qa-token");
    expect(qa.status).toBe(200);
    expect((await qa.json()).cycles).toEqual([]);
  });

  it("DM-P6: the analyst's defect write lands and is audit-attributed (ADR-0003)", async () => {
    const cycle2 = await cycleByNumber(2);
    const n = cycle2.total_defects;

    const created = await post(
      `/studies/${study1}/uat-cycles/${cycle2.id}/defects`,
      "dev-analyst-token",
      { title: "Derived age not recomputed after birth date correction", severity: "major" },
    );
    expect(created.status).toBe(201);
    const defect = await created.json();
    expect(defect.defect_number).toBe(n + 1);
    expect(defect.status).toBe("open");

    const res = await patch(
      `/studies/${study1}/uat-cycles/${cycle2.id}/defects/${defect.id}`,
      "dev-analyst-token",
      { status: "resolved", resolved_date: "2026-07-29" },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("resolved");

    const [event] = await owner`
      SELECT * FROM audit_event
      WHERE action = 'uat_defect.update' ORDER BY id DESC LIMIT 1`;
    expect(event!.actor_label).toMatch(/Priya Natarajan/);
    expect(event!.before.status).toBe("open");
    expect(event!.after.status).toBe("resolved");

    // restore for repeatable local runs (also audited)
    await patch(
      `/studies/${study1}/uat-cycles/${cycle2.id}/defects/${defect.id}`,
      "dev-analyst-token",
      { status: "open", resolved_date: null },
    );
  });

  it("read-only roles cannot write UAT: clinops and sponsor get 403; the analyst is study-scoped", async () => {
    const cycle2 = await cycleByNumber(2);
    const body = { title: "should never land", severity: "minor" };
    for (const token of ["dev-clinops-token", "dev-sponsor-token"]) {
      expect(
        (await post(`/studies/${study1}/uat-cycles/${cycle2.id}/defects`, token, body)).status,
      ).toBe(403);
    }
    // Priya is an analyst on DMOPS-001 only: UAT writes do not travel.
    expect(
      (await post(`/studies/${study2}/uat-cycles`, "dev-analyst-token", { title: "nope" })).status,
    ).toBe(403);
  });

  it("UAT.COMPLETE means defects resolved: completing a cycle with open defects is rejected (ADR-0010)", async () => {
    const cycle2 = await cycleByNumber(2);
    const blocked = await patch(`/studies/${study1}/uat-cycles/${cycle2.id}`, "dev-dmlead-token", {
      status: "complete",
      completed_date: "2026-07-30",
    });
    expect(blocked.status).toBe(400);
    expect((await blocked.json()).error).toMatch(/defects resolved/);

    // Full lifecycle on a throwaway cycle: create, log a defect, watch
    // completion refuse until the defect is closed with a dated, noted end.
    const created = await post(`/studies/${study1}/uat-cycles`, "dev-dmlead-token", {
      title: "Lifecycle exercise cycle (automated test)",
      started_date: "2026-07-30",
    });
    expect(created.status).toBe(201);
    const cycle = await created.json();
    expect(cycle.status).toBe("in_progress");

    const defect = await (
      await post(`/studies/${study1}/uat-cycles/${cycle.id}/defects`, "dev-analyst-token", {
        title: "Blocking finding for the lifecycle exercise",
        severity: "critical",
      })
    ).json();

    const early = await patch(`/studies/${study1}/uat-cycles/${cycle.id}`, "dev-dmlead-token", {
      status: "complete",
      completed_date: "2026-07-30",
    });
    expect(early.status).toBe(400);

    await patch(
      `/studies/${study1}/uat-cycles/${cycle.id}/defects/${defect.id}`,
      "dev-analyst-token",
      {
        status: "closed",
        resolved_date: "2026-07-30",
        resolution_note: "Verified fixed in the lifecycle exercise build.",
      },
    );
    const done = await patch(`/studies/${study1}/uat-cycles/${cycle.id}`, "dev-dmlead-token", {
      status: "complete",
      completed_date: "2026-07-30",
    });
    expect(done.status).toBe(200);
    expect((await done.json()).status).toBe("complete");
  });

  it("endings are dated facts: resolved without a date and closed without a substantive note are rejected", async () => {
    const cycle2 = await cycleByNumber(2);
    const open = (
      await (
        await get(`/studies/${study1}/uat-cycles/${cycle2.id}/defects`, "dev-dmlead-token")
      ).json()
    ).defects.find((d: { status: string }) => d.status === "open");

    const undated = await patch(
      `/studies/${study1}/uat-cycles/${cycle2.id}/defects/${open.id}`,
      "dev-dmlead-token",
      { status: "resolved" },
    );
    expect(undated.status).toBe(400);

    const unexplained = await patch(
      `/studies/${study1}/uat-cycles/${cycle2.id}/defects/${open.id}`,
      "dev-dmlead-token",
      { status: "closed", resolved_date: "2026-07-30", resolution_note: "ok" },
    );
    expect(unexplained.status).toBe(400);
  });

  it("ADR-0010: identity fields are not writable, and a finished cycle takes no new defects", async () => {
    const cycle1 = await cycleByNumber(1);
    const rename = await patch(`/studies/${study1}/uat-cycles/${cycle1.id}`, "dev-dmlead-token", {
      title: "Renamed cycle",
    });
    expect(rename.status).toBe(400);

    const late = await post(
      `/studies/${study1}/uat-cycles/${cycle1.id}/defects`,
      "dev-dmlead-token",
      {
        title: "Raised after the cycle closed",
        severity: "minor",
      },
    );
    expect(late.status).toBe(400);
  });
});

describe("metrics surface (DM-P1, DM-P2, DM-P3)", () => {
  it("DM-P2: every dictionary metric appears with its version and availability", async () => {
    const res = await get(`/studies/${study1}/metrics`, "dev-dmlead-token");
    const body = await res.json();
    const ids = body.metrics.map((m: { metric_id: string }) => m.metric_id).sort();
    expect(ids).toEqual(["entry_lag", "milestone_slip", "query_open_aging", "query_tat_median"]);
    // The engine-current version per metric: the two elapsed-time metrics
    // moved to business-day clocks as v1.1 (ADR-0004).
    const versions: Record<string, string> = {
      query_tat_median: "1.1",
      query_open_aging: "1.0",
      entry_lag: "1.1",
      milestone_slip: "1.0",
    };
    for (const m of body.metrics) {
      expect(m.availability).toBe("computed");
      expect(m.latest.metric_version).toBe(versions[m.metric_id]);
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
    // Two sites per seeded reporting period (the seed computes May and June).
    const june = rows.filter((r: { period_start: string }) => r.period_start === "2026-06-01");
    expect(june.length).toBe(2);
    for (const row of rows) {
      expect(row.metric_version).toBe("1.1");
      expect(row.grain).toBe("site");
    }
  });

  it("DM-P3: study-grain history spans reporting periods, newest first", async () => {
    const res = await get(
      `/studies/${study1}/metrics/query_tat_median/snapshots?grain=study`,
      "dev-qa-token",
    );
    const rows = await res.json();
    const periods = [...new Set(rows.map((r: { period_start: string }) => r.period_start))];
    expect(periods.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].period_start).toBe("2026-06-01");
  });

  it("DM-P2: the site drill-down serves the same versioned metric at site grain", async () => {
    const res = await get(`/studies/${study1}/metrics/query_tat_median/sites`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sites.map((s: { site_number: string }) => s.site_number)).toEqual(["001", "002"]);
    for (const site of body.sites) {
      expect(site.metric_version).toBe("1.1");
      expect(site.period_start).toBe("2026-06-01"); // latest, not history
    }
    // Hand-computed fixture truth (DM-Q5): business-day medians per site.
    expect(Number(body.sites[0].value)).toBe(4.0);
    expect(Number(body.sites[1].value)).toBe(4.5);
  });

  it("DM-P5: the site drill-down is row-scoped like every other read", async () => {
    expect(
      (await get(`/studies/${study2}/metrics/query_tat_median/sites`, "dev-sponsor-token")).status,
    ).toBe(403);
  });

  it("a study-grain-only metric returns an empty site list, not an error", async () => {
    const res = await get(`/studies/${study1}/metrics/milestone_slip/sites`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    expect((await res.json()).sites).toEqual([]);
  });
});
