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
    expect(body.migrations).toBe(10);
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
    expect(body.deliverables.length).toBe(6);
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
    expect(body.deliverables.length).toBe(6);
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

describe("stat module (ADR-0011)", () => {
  it("DM-P5: the board serves analysis rows only where the module is enabled", async () => {
    const stat = await (await get(`/studies/${study1}/milestones`, "dev-dmlead-token")).json();
    const analysis = stat.milestones.filter(
      (m: { phase_group: string }) => m.phase_group === "analysis",
    );
    expect(analysis.length).toBe(12);
    expect(analysis.map((m: { code: string }) => m.code)).toContain("STAT.DELIVER.FINAL");

    // DMOPS-002 never enabled stat: no analysis section, no permanently
    // hidden rows — the codes simply do not exist on this study.
    const dmOnly = await (await get(`/studies/${study2}/milestones`, "dev-qa-token")).json();
    expect(
      dmOnly.milestones.some((m: { phase_group: string }) => m.phase_group === "analysis"),
    ).toBe(false);
  });

  it("DM-P6: the programmer's analysis-phase write lands and is audit-attributed (ADR-0003)", async () => {
    const res = await patch(
      `/studies/${study1}/milestones/STAT.SDTM.PROD`,
      "dev-programmer-token",
      { forecast_date: "2026-08-24" },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).forecast_date).toBe("2026-08-24");

    const [event] = await owner`
      SELECT * FROM audit_event
      WHERE action = 'study_milestone.update' ORDER BY id DESC LIMIT 1`;
    expect(event!.actor_label).toMatch(/Tomas Lindqvist/);

    // restore for repeatable local runs (also audited)
    await patch(`/studies/${study1}/milestones/STAT.SDTM.PROD`, "dev-programmer-token", {
      forecast_date: "2026-08-21",
    });
  });

  it("DM-P6: the biostatistician writes analysis milestones, but DM-phase milestones stay leadership-only", async () => {
    const analysisWrite = await patch(
      `/studies/${study1}/milestones/STAT.TLF.SHELLS`,
      "dev-biostat-token",
      { forecast_date: "2026-08-13" },
    );
    expect(analysisWrite.status).toBe(200);
    await patch(`/studies/${study1}/milestones/STAT.TLF.SHELLS`, "dev-biostat-token", {
      forecast_date: "2026-08-12",
    });

    for (const token of ["dev-biostat-token", "dev-programmer-token"]) {
      const dmWrite = await patch(`/studies/${study1}/milestones/CLOSE.SDV`, token, {
        status: "in_progress",
      });
      expect(dmWrite.status).toBe(403);
    }
  });

  it("DM-P6: the analysis posture does not leak sideways — the analyst gets 403 on analysis milestones", async () => {
    const res = await patch(`/studies/${study1}/milestones/STAT.SDTM.QC`, "dev-analyst-token", {
      status: "in_progress",
    });
    expect(res.status).toBe(403);
  });

  it("analysis deliverable types accept the analysis posture; DM types do not (ADR-0011)", async () => {
    const all = (await (await get(`/studies/${study1}/deliverables`, "dev-biostat-token")).json())
      .deliverables;
    const shells = all.find((d: { type: string }) => d.type === "tlf_shells");
    const dmp = all.find((d: { type: string }) => d.type === "dmp");

    const allowed = await patch(
      `/studies/${study1}/deliverables/${shells.id}`,
      "dev-biostat-token",
      { version: "0.4" },
    );
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).version).toBe("0.4");
    await patch(`/studies/${study1}/deliverables/${shells.id}`, "dev-biostat-token", {
      version: "0.3",
    });

    const denied = await patch(`/studies/${study1}/deliverables/${dmp.id}`, "dev-biostat-token", {
      version: "2.1",
    });
    expect(denied.status).toBe(403);
  });

  it("DM-P1: a stat-module study serves the dm set plus the DS starter set (ADR-0012)", async () => {
    const res = await get(`/studies/${study1}/metrics`, "dev-biostat-token");
    expect(res.status).toBe(200);
    const ids = (await res.json()).metrics.map((m: { metric_id: string }) => m.metric_id).sort();
    expect(ids).toEqual([
      "access_training_gap",
      "entry_lag",
      "issue_closure_lag_median",
      "issue_open_aging",
      "lock_readiness_pct",
      "milestone_slip",
      "pr_cycle_time_median",
      "pr_review_tat_median",
      "query_open_aging",
      "query_tat_median",
      "training_current_pct",
    ]);
  });

  it("DM-P1: the module boundary hides stat metrics from a dm-only study entirely (ADR-0011)", async () => {
    const res = await get(`/studies/${study2}/metrics`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    const ids = (await res.json()).metrics.map((m: { metric_id: string }) => m.metric_id);
    expect(ids).not.toContain("pr_review_tat_median");
    expect(ids).not.toContain("issue_open_aging");
  });
});

describe("training and access mirrors (ADR-0013)", () => {
  // The view derives training status against CURRENT_DATE, so assertions
  // stay to facts that cannot flip as the clock advances: an expiry in the
  // past stays expired, an uncompleted assignment stays overdue, and an
  // empty transcript stays empty.
  const roster = async (studyId: string, token = "dev-dmlead-token") =>
    (await (await get(`/studies/${studyId}/access-roster`, token)).json()).people;

  it("DM-P1: the roster is mirrored from the source, one row per person, grants aggregated", async () => {
    const people = await roster(study1);
    expect(people.length).toBe(9); // 10 grants, 9 people — Maya holds two roles
    const maya = people.find((p: { person_key: string }) => p.person_key.startsWith("maya.okafor"));
    expect(maya.roles).toEqual(["data_manager", "safety_reviewer"]);
    expect(maya.account_status).toBe("active");
    expect(maya.trainings_on_file).toBe(3);
  });

  it("training_gap flags the inspection question: expired, overdue, and missing training on active access", async () => {
    const people = await roster(study1);
    const byKey = Object.fromEntries(
      people.map((p: { person_key: string }) => [p.person_key.split("@")[0], p]),
    );
    expect(byKey["tomas.lindqvist"].training_gap).toBe(true); // expired GCP
    expect(byKey["tomas.lindqvist"].trainings_expired).toBeGreaterThanOrEqual(1);
    expect(byKey["priya.natarajan"].training_gap).toBe(true); // overdue amendment training
    expect(byKey["s.park"].training_gap).toBe(true); // access with no training on file
    expect(byKey["s.park"].trainings_on_file).toBe(0);
    // A deactivated account is not an actionable gap — access is already gone.
    expect(byKey["r.chen"].account_status).toBe("deactivated");
    expect(byKey["r.chen"].training_gap).toBe(false);
  });

  it("DM-P4: training records serve dated status and provenance, never certificates", async () => {
    const res = await get(`/studies/${study1}/training`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    const { records } = await res.json();
    expect(records.length).toBe(20);
    const expired = records.find(
      (r: { person_key: string; course_key: string }) =>
        r.person_key.startsWith("tomas") && r.course_key === "GCP-2026",
    );
    expect(expired.status).toBe("expired");
    expect(expired.expires_date).toBe("2026-06-10");
    for (const r of records) {
      expect(r.mirrored_at).toBeTruthy();
      expect(
        Object.keys(r).some((k) => /content|file|blob|certificate|signature|signed/.test(k)),
      ).toBe(false);
    }
  });

  it("DM-P5: mirror reads are row-scoped; the sponsor sees the roster of its own study", async () => {
    expect((await get(`/studies/${study2}/access-roster`, "dev-sponsor-token")).status).toBe(403);
    const sponsorView = await roster(study1, "dev-sponsor-token");
    expect(sponsorView.length).toBe(9); // same rows for every role — nothing to curate
  });

  it("a study with no roster-capable source serves empty mirrors, not errors", async () => {
    expect(await roster(study2, "dev-qa-token")).toEqual([]);
    const training = await (await get(`/studies/${study2}/training`, "dev-qa-token")).json();
    expect(training.records).toEqual([]);
  });

  it("DM-Q7/DM-Q8: the roster metrics flow through the snapshot pipeline with the fixture truth", async () => {
    const body = await (await get(`/studies/${study1}/metrics`, "dev-dmlead-token")).json();
    const pct = body.metrics.find(
      (m: { metric_id: string }) => m.metric_id === "training_current_pct",
    );
    expect(pct.availability).toBe("computed");
    expect(Number(pct.latest.value)).toBe(84.2);
    const gap = body.metrics.find(
      (m: { metric_id: string }) => m.metric_id === "access_training_gap",
    );
    expect(gap.availability).toBe("computed");
    expect(Number(gap.latest.value)).toBe(4);
    expect(Number(gap.latest.denominator)).toBe(8);
  });
});

describe("lock-readiness (ADR-0014)", () => {
  // UAT rows accumulate across local runs without a re-seed (no DELETE
  // path), so the UAT signal assertions are lower bounds; the roster gap
  // count derives against CURRENT_DATE, so it is a lower bound too.
  const readiness = async (studyId: string, token = "dev-dmlead-token") =>
    await (await get(`/studies/${studyId}/lock-readiness`, token)).json();

  it("DM-P1: the checklist is the depends_on closure of CLOSE.LOCK, derived — never entered", async () => {
    const body = await readiness(study1);
    expect(body.gates.map((g: { code: string }) => g.code)).toEqual([
      "CLOSE.LPO",
      "CLOSE.ENTRY",
      "CLOSE.QUERY",
      "CLOSE.SAE",
      "CLOSE.CODE",
      "CLOSE.EXT",
      "CLOSE.SDV",
      "CLOSE.SOFTLOCK",
    ]);
    expect(body.gates_applicable).toBe(8);
    expect(body.gates_satisfied).toBe(0);
    expect(body.readiness_pct).toBe(0);
    expect(body.gates_blocked).toBe(1);
    expect(body.next_gate_code).toBe("CLOSE.LPO");
    expect(body.lock_planned_date).toBe("2027-04-26");
    const sae = body.gates.find((g: { code: string }) => g.code === "CLOSE.SAE");
    expect(sae.status).toBe("blocked");
    expect(sae.blocker_note).toMatch(/SAE discrepancies/);
  });

  it("signals ride beside the score and never move it: the score is 0 while the evidence shows live work", async () => {
    const body = await readiness(study1);
    // Latest query_open_aging snapshot: 4 open queries at June period end.
    expect(body.open_queries).toBe(4);
    expect(body.open_queries_as_of).toBe("2026-06-30");
    expect(body.uat_open_cycles).toBeGreaterThanOrEqual(1);
    expect(body.uat_unresolved_defects).toBeGreaterThanOrEqual(2);
    expect(body.training_gaps).toBeGreaterThanOrEqual(4);
    // No gate is asserted complete against contrary evidence.
    expect(body.evidence_conflicts).toEqual([]);
  });

  it("DM-P5: the sponsor serialization omits gate blocker notes, and reads are row-scoped", async () => {
    const sponsor = await readiness(study1, "dev-sponsor-token");
    const sae = sponsor.gates.find((g: { code: string }) => g.code === "CLOSE.SAE");
    expect(sae.status).toBe("blocked");
    expect("blocker_note" in sae).toBe(false);
    expect((await get(`/studies/${study2}/lock-readiness`, "dev-sponsor-token")).status).toBe(403);
  });

  it("a study with no wired sources serves named absence for signals, not fake zeros (ADR-0005)", async () => {
    const body = await readiness(study2, "dev-qa-token");
    expect(body.gates_applicable).toBe(8);
    expect(body.readiness_pct).toBe(0);
    // No metric source and no roster mirror: null, never zero.
    expect(body.open_queries).toBeNull();
    expect(body.open_queries_as_of).toBeNull();
    expect(body.training_gaps).toBeNull();
    // UAT is dmops-owned: zero cycles is a true zero.
    expect(body.uat_open_cycles).toBe(0);
    expect(body.uat_unresolved_defects).toBe(0);
  });

  it("DM-Q9: lock_readiness_pct flows through the snapshot pipeline as a dmops-native metric", async () => {
    const body = await (await get(`/studies/${study1}/metrics`, "dev-dmlead-token")).json();
    const pct = body.metrics.find(
      (m: { metric_id: string }) => m.metric_id === "lock_readiness_pct",
    );
    expect(pct.availability).toBe("computed");
    // As of the June period end no gate had an actual completion date.
    expect(Number(pct.latest.value)).toBe(0);
    expect(Number(pct.latest.denominator)).toBe(8);
  });
});

describe("metrics surface (DM-P1, DM-P2, DM-P3)", () => {
  it("DM-P2: every dictionary metric appears with its version and availability", async () => {
    const res = await get(`/studies/${study1}/metrics`, "dev-dmlead-token");
    const body = await res.json();
    const ids = body.metrics.map((m: { metric_id: string }) => m.metric_id).sort();
    expect(ids).toEqual([
      "access_training_gap",
      "entry_lag",
      "issue_closure_lag_median",
      "issue_open_aging",
      "lock_readiness_pct",
      "milestone_slip",
      "pr_cycle_time_median",
      "pr_review_tat_median",
      "query_open_aging",
      "query_tat_median",
      "training_current_pct",
    ]);
    // The engine-current version per metric: the four business-day clocks
    // subtract the study's holiday calendar (ADR-0016) — the elapsed-time
    // DM metrics at v1.2, the two PR metrics at v1.1; the rest of the DS
    // starter set (ADR-0012), the roster metrics (ADR-0013), and
    // lock-readiness (ADR-0014) ship at 1.0.
    const versions: Record<string, string> = {
      query_tat_median: "1.2",
      query_open_aging: "1.0",
      entry_lag: "1.2",
      milestone_slip: "1.0",
      lock_readiness_pct: "1.0",
      pr_review_tat_median: "1.1",
      pr_cycle_time_median: "1.1",
      issue_closure_lag_median: "1.0",
      issue_open_aging: "1.0",
      training_current_pct: "1.0",
      access_training_gap: "1.0",
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
      expect(row.metric_version).toBe("1.2");
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
      expect(site.metric_version).toBe("1.2");
      expect(site.period_start).toBe("2026-06-01"); // latest, not history
    }
    // Hand-computed fixture truth (DM-Q5): holiday-aware business-day
    // medians per site — DMOPS-001 observes the PMO calendar (ADR-0016).
    expect(Number(body.sites[0].value)).toBe(2.0);
    expect(Number(body.sites[1].value)).toBe(3.0);
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

describe("portfolio roll-up (ADR-0015)", () => {
  const portfolio = async (token = "dev-qa-token") => await (await get("/portfolio", token)).json();
  const metric = async (id: string) =>
    (await portfolio()).metrics.find((m: { metric_id: string }) => m.metric_id === id);

  it("DM-P5: the portfolio is one fact at portfolio grain — portfolio readers see it, study-scoped seats get 403, not a smaller number", async () => {
    expect((await get("/portfolio", "dev-qa-token")).status).toBe(200);
    expect((await get("/portfolio", "dev-admin-token")).status).toBe(200);
    for (const token of ["dev-dmlead-token", "dev-manager-token", "dev-sponsor-token"]) {
      expect((await get("/portfolio", token)).status).toBe(403);
    }
  });

  it("DM-P2: every dictionary metric appears once with a declared pooling kind, scoped to the studies that enabled its module", async () => {
    const body = await portfolio();
    expect(body.studies.total).toBe(2);
    expect(body.studies.stat_enabled).toBe(1);
    const ids = body.metrics.map((m: { metric_id: string }) => m.metric_id).sort();
    expect(ids).toEqual([
      "access_training_gap",
      "entry_lag",
      "issue_closure_lag_median",
      "issue_open_aging",
      "lock_readiness_pct",
      "milestone_slip",
      "pr_cycle_time_median",
      "pr_review_tat_median",
      "query_open_aging",
      "query_tat_median",
      "training_current_pct",
    ]);
    for (const m of body.metrics) {
      expect(["sum", "ratio", "median"]).toContain(m.pooling);
      // Module-aware scope (ADR-0011): only DMOPS-001 enabled stat.
      expect(m.studies_in_scope).toBe(m.module === "stat" ? 1 : 2);
    }
  });

  it("DM-P3: ratio metrics pool exactly from stored numerators and denominators — 0 of 16 lock gates across the portfolio", async () => {
    const lock = await metric("lock_readiness_pct");
    expect(lock.studies_reporting).toBe(2);
    expect(lock.poolable).toBe(true);
    // 0/8 satisfied on each study's latest snapshot (June): sums, not means.
    expect(lock.pooled).toEqual({ numerator: 0, denominator: 16, pct: 0 });
    // Fixture truth (DM-Q7): one study reports, so the pool is its parts.
    const training = await metric("training_current_pct");
    expect(training.pooled).toEqual({ numerator: 16, denominator: 19, pct: 84.2 });
  });

  it("medians never pool — a named absence with the per-study spread, not a fake portfolio median (ADR-0005)", async () => {
    const tat = await metric("query_tat_median");
    expect(tat.pooling).toBe("median");
    expect(tat.poolable).toBe(false);
    expect(tat.pooled).toBeNull();
    expect(tat.not_pooled_reason).toMatch(/median/);
    // The spread is the display: one reporting study, its June v1.2
    // holiday-aware value (DM-Q5, ADR-0016).
    expect(tat.per_study.length).toBe(1);
    expect(Number(tat.per_study[0].value)).toBe(3.0);
    // A dmops-native metric with nothing to measure still reports honestly:
    // DMOPS-002 has no completed milestones, so its value is null, not 0.
    const slip = await metric("milestone_slip");
    expect(slip.per_study.length).toBe(2);
    const study2Row = slip.per_study.find(
      (r: { protocol_number: string }) => r.protocol_number === "DMOPS-002",
    );
    expect(study2Row.value).toBeNull();
  });

  it("DM-P1: a metric no source can feed reports its honest scope — one of two studies reporting, pooled over the reporting study only", async () => {
    const aging = await metric("query_open_aging");
    expect(aging.studies_in_scope).toBe(2);
    expect(aging.studies_reporting).toBe(1);
    // Fixture truth (DM-Q2): 2 aged of 4 open as of the June period end.
    expect(aging.pooled).toEqual({ numerator: 2, denominator: 4, pct: 50 });
  });

  it("DM-Q9: the readiness burn-up serves one pooled point per reporting period from the monthly snapshots", async () => {
    const body = await portfolio();
    expect(body.lock.studies).toBe(2);
    expect(body.lock.gates_applicable).toBe(16);
    expect(body.lock.gates_satisfied).toBe(0);
    expect(body.lock.readiness_pct).toBe(0);
    const may = body.lock.trend.find(
      (t: { period_start: string }) => t.period_start === "2026-05-01",
    );
    const june = body.lock.trend.find(
      (t: { period_start: string }) => t.period_start === "2026-06-01",
    );
    for (const point of [may, june]) {
      expect(point.studies_reporting).toBe(2);
      expect(point.gates_applicable).toBe(16);
      expect(point.readiness_pct).toBe(0);
    }
    expect(june.period_end).toBe("2026-06-30");
  });
});

describe("exports and KPI packs (ADR-0016)", () => {
  it("DM-P3: the snapshot CSV is the immutable history flattened, provenance columns included", async () => {
    const res = await get(`/studies/${study1}/snapshots.csv`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/DMOPS-001-snapshots\.csv/);
    const lines = (await res.text()).trim().split("\r\n");
    expect(lines[0]).toBe(
      "metric_id,metric_version,grain,site_number,period_start,period_end," +
        "value,numerator,denominator,n_records,computed_at,source_extract_id," +
        "source_adapter,extract_checksum",
    );
    // Both seeded periods, every grain — the full history, not the strip.
    const cells = lines.slice(1).map((l) => l.split(","));
    expect(new Set(cells.map((c) => c[4]))).toEqual(new Set(["2026-05-01", "2026-06-01"]));
    const juneTatSite = cells.find(
      (c) => c[0] === "query_tat_median" && c[3] === "001" && c[4] === "2026-06-01",
    );
    // Holiday-aware fixture truth (DM-Q5) with the cited extract's checksum.
    expect(juneTatSite?.[1]).toBe("1.2");
    expect(Number(juneTatSite?.[6])).toBe(2.0);
    expect(juneTatSite?.[13]).toMatch(/^[0-9a-f]{64}$/);
    // A dmops-native metric cites no extract and the cells stay empty.
    const slip = cells.find((c) => c[0] === "milestone_slip");
    expect(slip?.[11]).toBe("");
  });

  it("DM-P5: the snapshot CSV is row-scoped exactly like the JSON it flattens", async () => {
    expect((await get(`/studies/${study1}/snapshots.csv`, "dev-sponsor-token")).status).toBe(200);
    expect((await get(`/studies/${study2}/snapshots.csv`, "dev-sponsor-token")).status).toBe(403);
  });

  it("DM-P5: the portfolio CSV requires portfolio read and keeps the named absences", async () => {
    expect((await get("/portfolio.csv", "dev-dmlead-token")).status).toBe(403);
    const res = await get("/portfolio.csv", "dev-qa-token");
    expect(res.status).toBe(200);
    const lines = (await res.text()).trim().split("\r\n");
    const cells = lines.slice(1).map((l) => l.split(","));
    // One rollup row per metric, spread rows where pooling declined.
    const tatRollup = cells.find((c) => c[0] === "rollup" && c[2] === "query_tat_median");
    expect(tatRollup?.[9]).toMatch(/median/); // not_pooled_reason survives flattening
    expect(tatRollup?.[10]).toBe(""); // pooled_numerator stays empty, not zero
    const tatSpread = cells.filter((c) => c[0] === "study" && c[2] === "query_tat_median");
    expect(tatSpread.length).toBe(1);
    expect(Number(tatSpread[0]?.[18])).toBe(3.0);
    const aging = cells.find((c) => c[0] === "rollup" && c[2] === "query_open_aging");
    expect(aging?.[10]).toBe("2"); // exact pooling still pools
    expect(aging?.[11]).toBe("4");
  });

  it("DM-P2: the pack serves each metric's registered definition at the computed version, with extract citations", async () => {
    const res = await get(`/studies/${study1}/kpi-pack`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    const pack = await res.json();
    // Defaults to the latest reporting period with snapshots.
    expect(pack.period).toEqual({ start: "2026-06-01", end: "2026-06-30" });
    expect(pack.available_periods).toEqual(["2026-06", "2026-05"]);
    expect(pack.study.protocol_number).toBe("DMOPS-001");
    expect(pack.study.calendar).toEqual({ id: "pmo", label: "PMO observed holidays (fictional)" });
    expect(pack.generated_by).toMatch(/Maya/);
    expect(pack.metrics.length).toBe(11);
    const tat = pack.metrics.find((m: { metric_id: string }) => m.metric_id === "query_tat_median");
    expect(tat.version).toBe("1.2");
    expect(tat.definition).toMatch(/holiday calendar/);
    expect(tat.absence).toBeNull();
    expect(Number(tat.snapshot.value)).toBe(3.0);
    expect(tat.sites.length).toBe(2);
    // Every cited extract travels with the pack, checksummed.
    expect(pack.provenance.extracts.length).toBeGreaterThanOrEqual(1);
    for (const e of pack.provenance.extracts) {
      expect(e.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(tat.snapshot.source_extract_id).toBeTruthy();
    const cited = pack.provenance.extracts.find(
      (e: { id: string }) => e.id === tat.snapshot.source_extract_id,
    );
    expect(cited).toBeTruthy();
  });

  it("DM-P2: the pack is period-scoped — May on request, 404 for a period never computed", async () => {
    const may = await (
      await get(`/studies/${study1}/kpi-pack?period=2026-05`, "dev-qa-token")
    ).json();
    expect(may.period.start).toBe("2026-05-01");
    // May predates the calendar's June dates, so the May TAT is the
    // weekday-only number — recomputed under v1.2, same value.
    const tat = may.metrics.find((m: { metric_id: string }) => m.metric_id === "query_tat_median");
    expect(tat.snapshot.period_start).toBe("2026-05-01");
    expect((await get(`/studies/${study1}/kpi-pack?period=2030-01`, "dev-qa-token")).status).toBe(
      404,
    );
  });

  it("DM-P1/DM-P5: a sourceless study's pack names its absences; the pack is row-scoped", async () => {
    const res = await get(`/studies/${study2}/kpi-pack`, "dev-dmlead-token");
    expect(res.status).toBe(200);
    const pack = await res.json();
    expect(pack.study.calendar).toBeNull();
    // dm module only: the stat metrics are out of scope entirely (ADR-0011).
    expect(pack.metrics.length).toBe(7);
    const tat = pack.metrics.find((m: { metric_id: string }) => m.metric_id === "query_tat_median");
    expect(tat.snapshot).toBeNull();
    expect(tat.absence).toMatch(/no snapshot/);
    const slip = pack.metrics.find((m: { metric_id: string }) => m.metric_id === "milestone_slip");
    expect(slip.snapshot).toBeTruthy();
    expect((await get(`/studies/${study2}/kpi-pack`, "dev-sponsor-token")).status).toBe(403);
  });
});
