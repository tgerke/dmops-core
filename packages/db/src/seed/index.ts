/**
 * Demo seed — DESTRUCTIVE. Truncates every table (including the audit trail
 * and the metric warehouse) and rebuilds the demo portfolio from scratch.
 * Never point this at a real deployment.
 *
 * Narrative: two studies for the fictional sponsor Meridian Oncology.
 * DMOPS-001 is mid-conduct — startup complete (with honest slips), an
 * amendment in flight, interim lock on the horizon, SAE reconciliation
 * blocked — and wired to the CSV fixture study so the metrics strip is live
 * on first boot. It also runs the stat module (ADR-0011): analysis work is
 * in flight toward the September interim, so the phase-scoped write posture
 * is demoable, and the fixture dir carries repository frames (issues, pull
 * requests, reviews) so the DS metrics compute too (ADR-0012). DMOPS-002 is
 * DM-only and in startup with almost nothing done, so the board's
 * early-life state and the module-off posture are visible too.
 *
 * All writes are audit-attributed to 'seed' (ADR-0003). Person and study ids
 * regenerate on every run.
 */
import { refreshStudyMetrics, registerMetrics } from "@dmops/core";
import { type Sql, createDb } from "../client.js";
import { loadTaxonomy, syncTaxonomy } from "../sync-taxonomy.js";

// The fixture study's reporting periods (see fixtures/study-DMOPS-001).
// June is the hand-computed qualification period (expected-values.json); May
// exists so snapshot history has a real trend on first boot. Chronological
// order, so v_metric_latest lands on the newest period.
const PERIODS = [
  { periodStart: "2026-05-01", periodEnd: "2026-05-31" },
  { periodStart: "2026-06-01", periodEnd: "2026-06-30" },
];

const { sql } = createDb();

console.log("seeding dmops demo data (DESTRUCTIVE: all existing rows are removed)");

await sql.begin(async (t) => {
  const tx = t as unknown as Sql;
  await tx`SELECT set_config('dmops.actor_label', 'seed', true)`;
  await tx`
    TRUNCATE audit_event, metric_snapshot, source_extract, metric_definition,
             training_mirror, access_mirror,
             uat_defect, uat_cycle, milestone_rebaseline, study_milestone,
             deliverable, study_source, study_assignment, site, study, sponsor,
             person, milestone_definition
    RESTART IDENTITY CASCADE`;
});

await syncTaxonomy(sql);
await registerMetrics(sql, "seed");

interface Person {
  id: string;
  name: string;
}

async function insertPerson(name: string, email: string, org: string): Promise<Person> {
  const [row] = await withSeedActor(
    (tx) => tx`
      INSERT INTO person (name, email, org) VALUES (${name}, ${email}, ${org})
      RETURNING id, name`,
  );
  return row as unknown as Person;
}

async function withSeedActor<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    await tx`SELECT set_config('dmops.actor_label', 'seed', true)`;
    return fn(tx);
  }) as Promise<T>;
}

// --- people -----------------------------------------------------------------

const maya = await insertPerson("Maya Okafor", "maya.okafor@pmo.example", "PMO");
const daniel = await insertPerson("Daniel Reyes", "daniel.reyes@pmo.example", "PMO");
const priya = await insertPerson("Priya Natarajan", "priya.natarajan@pmo.example", "PMO");
const tomas = await insertPerson("Tomas Lindqvist", "tomas.lindqvist@pmo.example", "PMO");
const grace = await insertPerson("Grace Liu", "grace.liu@pmo.example", "PMO");
const omar = await insertPerson("Omar Haddad", "omar.haddad@pmo.example", "PMO");
const sylvia = await insertPerson(
  "Sylvia Tran",
  "sylvia.tran@meridian.example",
  "Meridian Oncology",
);
const ruth = await insertPerson("Ruth Adler", "ruth.adler@gcpaudit.example", "GCP Audit Partners");
const admin = await insertPerson("Alex Admin", "alex.admin@pmo.example", "PMO");

// --- sponsor, studies, sites ------------------------------------------------

const [meridian] = await withSeedActor(
  (tx) => tx`INSERT INTO sponsor (name) VALUES ('Meridian Oncology') RETURNING id`,
);

// DMOPS-001 runs analysis in house, so the stat module is on (ADR-0011).
const [study1] = await withSeedActor(
  (tx) => tx`
    INSERT INTO study
      (protocol_number, short_title, sponsor_id, phase, indication, therapeutic_area, status, dm_lead_id, modules)
    VALUES
      ('DMOPS-001', 'Abiraterone combination in metastatic prostate cancer',
       ${meridian!.id}, '2', 'Metastatic prostate cancer', 'Oncology', 'enrolling', ${maya.id},
       '{dm,stat}'::module[])
    RETURNING id`,
);
const [study2] = await withSeedActor(
  (tx) => tx`
    INSERT INTO study
      (protocol_number, short_title, sponsor_id, phase, indication, therapeutic_area, status, dm_lead_id)
    VALUES
      ('DMOPS-002', 'Adjuvant biomarker registry in high-risk localized disease',
       ${meridian!.id}, '2', 'Localized prostate cancer', 'Oncology', 'startup', ${maya.id})
    RETURNING id`,
);
const study1Id = study1!.id as string;
const study2Id = study2!.id as string;

await withSeedActor(
  (tx) => tx`
    INSERT INTO site (study_id, site_number, name, country, pi_name, activation_date) VALUES
      (${study1Id}, '001', 'General Clinical Research Center', 'US', 'Dr. H. Whitfield', '2026-02-10'),
      (${study1Id}, '002', 'Memorial Cancer Institute', 'US', 'Dr. S. Park', '2026-02-24')`,
);

const assignments: [string, string, string][] = [
  [study1Id, maya.id, "dm_lead"],
  [study1Id, daniel.id, "dm_manager"],
  [study1Id, priya.id, "analyst"],
  [study1Id, tomas.id, "programmer"],
  [study1Id, grace.id, "clinops"],
  [study1Id, omar.id, "biostat"],
  [study1Id, sylvia.id, "sponsor_user"],
  [study1Id, ruth.id, "qa"],
  [study1Id, admin.id, "admin"],
  [study2Id, maya.id, "dm_lead"],
  [study2Id, daniel.id, "dm_manager"],
  [study2Id, tomas.id, "programmer"],
  [study2Id, ruth.id, "qa"],
];
for (const [studyId, personId, role] of assignments) {
  await withSeedActor(
    (tx) => tx`
      INSERT INTO study_assignment (study_id, person_id, role, start_date)
      VALUES (${studyId}, ${personId}, ${role}::assignment_role, '2026-01-05')`,
  );
}

// --- milestones -------------------------------------------------------------

const ownerByRole: Record<string, string> = {
  dm_lead: maya.id,
  dm_manager: daniel.id,
  analyst: priya.id,
  programmer: tomas.id,
  biostat: omar.id,
};

interface MilestoneSeed {
  baseline?: string;
  planned?: string;
  forecast?: string;
  actual?: string;
  status?: "not_started" | "in_progress" | "complete" | "blocked" | "na";
  blocker?: string;
  evidence?: string;
}

// DMOPS-001: startup done with honest slips; June completions feed the
// milestone_slip demo number (slips +4, +5, -2 → median 4).
const study1Milestones: Record<string, MilestoneSeed> = {
  "SPEC.DMP.DRAFT": {
    baseline: "2026-01-12",
    actual: "2026-01-12",
    status: "complete",
    evidence: "https://ctms.example/tmf/DMOPS-001/dmp-draft",
  },
  "SPEC.DMP.APPROVED": {
    baseline: "2026-01-26",
    actual: "2026-01-30",
    status: "complete",
    evidence: "https://ctms.example/tmf/DMOPS-001/dmp",
  },
  "SPEC.CRF.DRAFT": { baseline: "2026-01-19", actual: "2026-01-16", status: "complete" },
  "SPEC.CRF.APPROVED": {
    baseline: "2026-02-02",
    actual: "2026-02-06",
    status: "complete",
    evidence: "https://ctms.example/tmf/DMOPS-001/crf-spec",
  },
  "SPEC.CCG": { baseline: "2026-02-16", actual: "2026-02-16", status: "complete" },
  "SPEC.EDIT.DRAFT": { baseline: "2026-02-09", actual: "2026-02-13", status: "complete" },
  "SPEC.EDIT.APPROVED": {
    baseline: "2026-02-23",
    actual: "2026-02-27",
    status: "complete",
    evidence: "https://ctms.example/tmf/DMOPS-001/edit-checks",
  },
  "SPEC.EXT.AGREED": { baseline: "2026-02-16", actual: "2026-03-06", status: "complete" },
  "SPEC.CODING": { baseline: "2026-02-09", actual: "2026-02-09", status: "complete" },
  "SPEC.SDTM": { baseline: "2026-03-02", actual: "2026-03-09", status: "complete" },
  "BUILD.DB.START": { baseline: "2026-02-09", actual: "2026-02-09", status: "complete" },
  "BUILD.DB.COMPLETE": { baseline: "2026-03-02", actual: "2026-03-06", status: "complete" },
  "BUILD.EDIT.COMPLETE": { baseline: "2026-03-09", actual: "2026-03-19", status: "complete" },
  "BUILD.EXT.CONFIG": { baseline: "2026-03-16", actual: "2026-03-27", status: "complete" },
  "BUILD.REPORTS": { baseline: "2026-03-23", actual: "2026-03-23", status: "complete" },
  "BUILD.DATASETS": { baseline: "2026-04-06", actual: "2026-04-10", status: "complete" },
  "UAT.START": { baseline: "2026-03-23", actual: "2026-03-25", status: "complete" },
  "UAT.COMPLETE": { baseline: "2026-04-06", actual: "2026-04-09", status: "complete" },
  "VAL.SUMMARY": {
    baseline: "2026-04-13",
    actual: "2026-04-15",
    status: "complete",
    evidence: "https://ctms.example/tmf/DMOPS-001/validation-summary",
  },
  "REL.GOLIVE": { baseline: "2026-04-20", actual: "2026-04-21", status: "complete" },
  "REL.TRAIN": { baseline: "2026-06-01", actual: "2026-06-05", status: "complete" },
  "REL.ACCESS": { baseline: "2026-04-27", actual: "2026-04-27", status: "complete" },
  "COND.FPI": { baseline: "2026-05-04", actual: "2026-05-08", status: "complete" },
  "COND.RECON.FIRST": { baseline: "2026-06-15", actual: "2026-06-20", status: "complete" },
  "COND.REVIEW.FIRST": { baseline: "2026-06-27", actual: "2026-06-25", status: "complete" },
  "COND.AMEND": { baseline: "2026-08-03", forecast: "2026-08-14", status: "in_progress" },
  "COND.INTERIM": { baseline: "2026-09-15", forecast: "2026-09-15", status: "not_started" },
  "CLOSE.LPO": { baseline: "2027-03-01", status: "not_started" },
  "CLOSE.ENTRY": { baseline: "2027-03-22", status: "not_started" },
  "CLOSE.QUERY": { baseline: "2027-04-05", status: "not_started" },
  "CLOSE.SAE": {
    baseline: "2026-09-01",
    forecast: "2026-09-22",
    status: "blocked",
    blocker:
      "Safety DB reconciliation for the interim cut is stalled: 14 SAE discrepancies open with the vendor since 2026-07-06",
  },
  "CLOSE.CODE": { baseline: "2027-04-05", status: "not_started" },
  "CLOSE.EXT": { baseline: "2027-04-12", status: "not_started" },
  "CLOSE.SDV": { baseline: "2027-04-12", status: "not_started" },
  "CLOSE.SOFTLOCK": { baseline: "2027-04-19", status: "not_started" },
  "CLOSE.LOCK": { baseline: "2027-04-26", status: "not_started" },
  "CLOSE.TRANSFER": { baseline: "2027-04-28", status: "not_started" },
  "CLOSE.ARCHIVE": { baseline: "2027-06-01", status: "not_started" },
  // Analysis phase (stat module, ADR-0011): SAP and ADaM spec approved,
  // production programming in flight toward the September interim. The SAP
  // completion sits in May with slip +4, matching COND.FPI, so the seeded May
  // milestone_slip median stays 4; no analysis completion lands in June (the
  // hand-computed qualification period). BUILD.DATASETS stays complete: it
  // landed in April, before the module was enabled, and history is history —
  // the "mark it na" guidance applies prospectively.
  "STAT.SAP.APPROVED": {
    baseline: "2026-05-25",
    actual: "2026-05-29",
    status: "complete",
    evidence: "https://ctms.example/tmf/DMOPS-001/sap",
  },
  "STAT.SDTM.PROD": { baseline: "2026-08-14", forecast: "2026-08-21", status: "in_progress" },
  "STAT.SDTM.QC": { baseline: "2026-08-28", status: "not_started" },
  "STAT.ADAM.SPEC": {
    baseline: "2026-07-06",
    actual: "2026-07-10",
    status: "complete",
    evidence: "https://ctms.example/tmf/DMOPS-001/adam-spec",
  },
  "STAT.ADAM.PROD": { baseline: "2026-09-04", status: "not_started" },
  "STAT.ADAM.QC": { baseline: "2026-09-11", status: "not_started" },
  "STAT.TLF.SHELLS": { baseline: "2026-08-10", forecast: "2026-08-12", status: "in_progress" },
  "STAT.TLF.PROD": { baseline: "2026-09-18", status: "not_started" },
  "STAT.TLF.QC": { baseline: "2026-09-24", status: "not_started" },
  "STAT.DRYRUN": { baseline: "2026-09-25", status: "not_started" },
  "STAT.DELIVER.INTERIM": { baseline: "2026-09-29", status: "not_started" },
  "STAT.DELIVER.FINAL": { baseline: "2027-05-14", status: "not_started" },
};

// DMOPS-002: startup barely begun.
const study2Milestones: Record<string, MilestoneSeed> = {
  "SPEC.DMP.DRAFT": { baseline: "2026-08-10", forecast: "2026-08-10", status: "in_progress" },
  "SPEC.CRF.DRAFT": { baseline: "2026-08-24", status: "not_started" },
};

async function instantiateMilestones(
  studyId: string,
  seeds: Record<string, MilestoneSeed>,
  modules: string[] = ["dm"],
): Promise<void> {
  // Instantiation is module-filtered (ADR-0011): a study never carries rows
  // for codes in a module it has not enabled.
  for (const def of loadTaxonomy().filter((d) => modules.includes(d.module))) {
    const s = seeds[def.code] ?? {};
    const baseline = s.baseline ?? null;
    await withSeedActor(
      (tx) => tx`
        INSERT INTO study_milestone
          (study_id, code, occurrence, baseline_date, planned_date, forecast_date,
           actual_date, status, owner_id, blocker_note, evidence_uri)
        VALUES
          (${studyId}, ${def.code}, 1, ${baseline}, ${s.planned ?? baseline},
           ${s.forecast ?? null}, ${s.actual ?? null},
           ${s.status ?? "not_started"}::milestone_status,
           ${ownerByRole[def.default_owner_role] ?? maya.id},
           ${s.blocker ?? null}, ${s.evidence ?? null})`,
    );
  }
}

await instantiateMilestones(study1Id, study1Milestones, ["dm", "stat"]);
await instantiateMilestones(study2Id, study2Milestones);

// --- deliverables (status + eTMF pointer only, ADR-0006) ---------------------

await withSeedActor(
  (tx) => tx`
    INSERT INTO deliverable (study_id, type, title, version, status, approved_date, etmf_uri, owner_id) VALUES
      (${study1Id}, 'dmp', 'Data Management Plan', '2.0', 'approved', '2026-01-30',
       'https://ctms.example/tmf/DMOPS-001/dmp', ${maya.id}),
      (${study1Id}, 'edit_check_spec', 'Edit Check Specification', '1.3', 'approved', '2026-02-27',
       'https://ctms.example/tmf/DMOPS-001/edit-checks', ${priya.id}),
      (${study1Id}, 'sdtm_spec', 'SDTM Mapping Specification', '0.9', 'in_review', NULL,
       'https://ctms.example/tmf/DMOPS-001/sdtm-spec', ${tomas.id}),
      (${study1Id}, 'sap', 'Statistical Analysis Plan', '1.0', 'approved', '2026-05-29',
       'https://ctms.example/tmf/DMOPS-001/sap', ${omar.id}),
      (${study1Id}, 'adam_spec', 'ADaM Specification', '1.0', 'approved', '2026-07-10',
       'https://ctms.example/tmf/DMOPS-001/adam-spec', ${omar.id}),
      (${study1Id}, 'tlf_shells', 'TLF Shells', '0.3', 'in_review', NULL, NULL, ${omar.id}),
      (${study2Id}, 'dmp', 'Data Management Plan', '0.2', 'draft', NULL, NULL, ${maya.id})`,
);

// --- UAT cycles and defects (ADR-0010) ---------------------------------------
// Cycle 1 matches the completed UAT.START/UAT.COMPLETE milestone actuals;
// cycle 2 is the Amendment 3 regression round in flight, with an open critical
// defect visibly blocking completion. DMOPS-002 has none (empty state).

const [uatCycle1] = await withSeedActor(
  (tx) => tx`
    INSERT INTO uat_cycle
      (study_id, cycle_number, title, status, started_date, completed_date,
       scripts_planned, scripts_executed, evidence_uri)
    VALUES
      (${study1Id}, 1, 'Initial build UAT', 'complete', '2026-03-25', '2026-04-09',
       42, 42, 'https://ctms.example/tmf/DMOPS-001/uat-summary')
    RETURNING id`,
);
const [uatCycle2] = await withSeedActor(
  (tx) => tx`
    INSERT INTO uat_cycle
      (study_id, cycle_number, title, status, started_date, completed_date,
       scripts_planned, scripts_executed, evidence_uri)
    VALUES
      (${study1Id}, 2, 'Amendment 3 regression UAT', 'in_progress', '2026-07-20', NULL,
       18, 11, NULL)
    RETURNING id`,
);

await withSeedActor(
  (tx) => tx`
    INSERT INTO uat_defect
      (cycle_id, defect_number, title, severity, status, raised_date, resolved_date, resolution_note) VALUES
      (${uatCycle1!.id as string}, 1, 'Visit window check fires on unscheduled visits', 'critical', 'closed',
       '2026-03-27', '2026-04-01', 'Check re-scoped to scheduled visits only; retested on script 12.'),
      (${uatCycle1!.id as string}, 2, 'Concomitant medication end date allows dates before start date', 'major', 'closed',
       '2026-03-28', '2026-04-03', 'Range check corrected and retested on scripts 18 and 19.'),
      (${uatCycle1!.id as string}, 3, 'Lab unit conversion drops the original value on edit', 'major', 'closed',
       '2026-03-30', '2026-04-06', 'Derivation rebuilt to preserve source value; retested on script 27.'),
      (${uatCycle1!.id as string}, 4, 'Query text truncated at 200 characters in the review listing', 'minor', 'closed',
       '2026-04-01', '2026-04-07', 'Listing widened; confirmed against the longest seeded query.'),
      (${uatCycle1!.id as string}, 5, 'Duplicate of the visit window finding', 'minor', 'withdrawn',
       '2026-04-02', NULL, 'Duplicate of defect 1; tracked and verified there.'),
      (${uatCycle2!.id as string}, 1, 'New PSA edit check fires on the baseline visit', 'critical', 'open',
       '2026-07-22', NULL, NULL),
      (${uatCycle2!.id as string}, 2, 'Amended visit schedule not reflected in the entry calendar', 'major', 'resolved',
       '2026-07-23', '2026-07-28', NULL),
      (${uatCycle2!.id as string}, 3, 'Tooltip typo on the new eligibility form', 'minor', 'closed',
       '2026-07-24', '2026-07-27', 'Corrected in build 2026-07-27-02 and retested.')`,
);

// --- source wiring + first snapshot run --------------------------------------

await withSeedActor(
  (tx) => tx`
    INSERT INTO study_source (study_id, adapter, source_study_key, config)
    VALUES (${study1Id}, 'csv', 'DMOPS-001',
            ${JSON.stringify({ dir: "fixtures/study-DMOPS-001" })}::jsonb)`,
);

for (const [protocol, studyId] of [
  ["DMOPS-001", study1Id],
  ["DMOPS-002", study2Id],
] as const) {
  for (const period of PERIODS) {
    const result = await refreshStudyMetrics(sql, studyId, period);
    console.log(
      `${protocol} ${period.periodStart.slice(0, 7)}: ${result.computed.length} metrics computed, ${result.skipped.length} skipped${
        result.skipped.length
          ? ` (${result.skipped.map((s) => `${s.metricId}: ${s.reason}`).join("; ")})`
          : ""
      }${
        result.mirrored.length
          ? `, mirrored ${result.mirrored.map((m) => `${m.frame} ${m.rows}`).join(", ")}`
          : ""
      }`,
    );
    for (const warning of result.warnings) console.log(`  warning: ${warning}`);
  }
}

const [chain] = await sql`SELECT count(*)::int AS n FROM dmops_verify_audit_chain()`;
if (chain!.n !== 0) throw new Error("audit chain verification failed after seed");

console.log("seed complete — audit chain verifies clean");
console.log(
  "dev tokens: dev-dmlead-token (Maya), dev-manager-token (Daniel), dev-analyst-token (Priya),",
);
console.log(
  "            dev-programmer-token (Tomas), dev-biostat-token (Omar), dev-clinops-token (Grace),",
);
console.log("            dev-sponsor-token (Sylvia), dev-qa-token (Ruth), dev-admin-token (Alex)");
await sql.end();
