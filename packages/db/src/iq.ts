/**
 * Installation Qualification (IQ): one command that checks a live environment
 * against the installed controls the compliance mapping claims — migrations,
 * triggers, role privileges, the audit hash chain, and the metric dictionary —
 * and prints a signed-off-able report. Exit code 1 on any FAIL.
 *
 * Usage: pnpm validation:iq [--report path.md]
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { createDb } from "./client.js";

type Level = "PASS" | "FAIL" | "WARN";
const results: { level: Level; check: string; detail: string }[] = [];
const record = (level: Level, check: string, detail: string) =>
  results.push({ level, check, detail });
const ok = (cond: boolean, check: string, detail: string) =>
  record(cond ? "PASS" : "FAIL", check, detail);

// metric_snapshot and source_extract are machine-derived, immutable, and carry
// their own extract provenance (see 0001_audit_and_views.sql); audit_event
// cannot audit itself.
const AUDIT_EXEMPT = new Set(["metric_snapshot", "source_extract", "audit_event"]);

// Append-only warehouse + audit trail + governance records (DM-P3, ADR-0007,
// ADR-0009).
const IMMUTABLE_TABLES = [
  "audit_event",
  "metric_snapshot",
  "source_extract",
  "metric_definition",
  "milestone_rebaseline",
];

async function main() {
  const { sql } = createDb();

  // migrations applied = journal entries
  const journalPath = fileURLToPath(new URL("../migrations/meta/_journal.json", import.meta.url));
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
  const [migrations] = await sql`
    SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
  ok(
    migrations!.n === journal.entries.length,
    "migrations applied",
    `${migrations!.n} applied, ${journal.entries.length} in journal`,
  );

  // immutability triggers (DM-P3)
  for (const table of IMMUTABLE_TABLES) {
    const [trigger] = await sql`
      SELECT count(*)::int AS n FROM pg_trigger
      WHERE tgname = ${`${table}_immutable`} AND NOT tgisinternal`;
    ok(
      trigger!.n === 1,
      `immutability trigger on ${table}`,
      trigger!.n === 1 ? "present" : "MISSING",
    );
  }

  // every domain table carries the audit trigger (ADR-0003)
  const unaudited = await sql`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = c.oid AND p.proname = 'dmops_audit' AND NOT t.tgisinternal)
    ORDER BY c.relname`;
  const missing = unaudited.map((r) => r.relname as string).filter((t) => !AUDIT_EXEMPT.has(t));
  ok(
    missing.length === 0,
    "audit trigger on every domain table",
    missing.length
      ? `missing on: ${missing.join(", ")}`
      : `all audited (exempt by design: ${[...AUDIT_EXEMPT].join(", ")})`,
  );

  // audit writer runs as definer; runtime role cannot forge events
  const [prosecdef] = await sql`
    SELECT prosecdef FROM pg_proc WHERE proname = 'dmops_audit'`;
  ok(
    Boolean(prosecdef?.prosecdef),
    "dmops_audit() is SECURITY DEFINER",
    String(prosecdef?.prosecdef),
  );

  // roles and privilege ceilings
  for (const role of ["dmops_app", "dmops_readonly"]) {
    const [row] = await sql`SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${role}`;
    ok(row!.n === 1, `role ${role} exists`, row!.n === 1 ? "present" : "MISSING");
  }
  const [privileges] = await sql`
    SELECT has_schema_privilege('dmops_app', 'public', 'CREATE') AS can_create,
           has_table_privilege('dmops_app', 'audit_event', 'INSERT') AS can_forge,
           has_table_privilege('dmops_app', 'person', 'TRUNCATE') AS can_truncate,
           has_table_privilege('dmops_app', 'metric_snapshot', 'UPDATE') AS can_rewrite`;
  ok(!privileges!.can_create, "dmops_app cannot CREATE in schema", String(privileges!.can_create));
  ok(
    !privileges!.can_forge,
    "dmops_app cannot INSERT audit_event directly",
    String(privileges!.can_forge),
  );
  ok(!privileges!.can_truncate, "dmops_app cannot TRUNCATE", String(privileges!.can_truncate));
  ok(
    !privileges!.can_rewrite,
    "dmops_app cannot UPDATE metric_snapshot",
    String(privileges!.can_rewrite),
  );

  // structural display-only posture (DM-P4, ADR-0006)
  const signatureish = await sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (column_name ILIKE '%signature%' OR column_name ILIKE '%signed%')`;
  ok(
    signatureish.length === 0,
    "no signature columns anywhere in schema",
    signatureish.length
      ? signatureish.map((r) => `${r.table_name}.${r.column_name}`).join(", ")
      : "schema is structurally display-only",
  );

  // audit hash chain verifies end to end (ADR-0003)
  const problems = await sql`SELECT * FROM dmops_verify_audit_chain()`;
  const [events] = await sql`SELECT count(*)::int AS n FROM audit_event`;
  ok(
    problems.length === 0,
    "audit hash chain verifies",
    `${events!.n} events, ${problems.length} problems`,
  );

  // registered metric definitions match the governed dictionary (DM-P2, ADR-0004)
  const metricsDir = fileURLToPath(new URL("../../../metrics", import.meta.url));
  const files = readdirSync(metricsDir).filter((f) => f.endsWith(".yaml"));
  const registered = await sql`
    SELECT metric_id, version, spec_checksum FROM metric_definition`;
  if (registered.length === 0) {
    record(
      "WARN",
      "metric dictionary registered",
      "no metric_definition rows — run the seed or metric registration",
    );
  } else {
    let mismatches = 0;
    for (const f of files) {
      const raw = readFileSync(join(metricsDir, f), "utf8");
      const spec = parse(raw) as { id: string; version: string };
      const checksum = createHash("sha256").update(raw).digest("hex");
      const row = registered.find((r) => r.metric_id === spec.id && r.version === spec.version);
      if (row && row.spec_checksum !== checksum) mismatches++;
    }
    ok(
      mismatches === 0,
      "registered metric checksums match metrics/*.yaml",
      mismatches
        ? `${mismatches} file(s) changed without a version bump`
        : `${files.length} files checked against ${registered.length} registered versions`,
    );
  }

  // auth posture
  const mode = process.env.DMOPS_AUTH_MODE;
  if (mode === "oidc") record("PASS", "DMOPS_AUTH_MODE", "oidc");
  else
    record(
      "WARN",
      "DMOPS_AUTH_MODE",
      `'${mode ?? "unset"}' — dev tokens are not a production access-control posture`,
    );

  await sql.end();

  const lines = results.map((r) => `[${r.level}] ${r.check} — ${r.detail}`);
  console.log(lines.join("\n"));
  const failures = results.filter((r) => r.level === "FAIL").length;
  const warnings = results.filter((r) => r.level === "WARN").length;
  console.log(`\nIQ: ${results.length} checks, ${failures} failed, ${warnings} warnings`);

  const reportFlag = process.argv.indexOf("--report");
  if (reportFlag !== -1 && process.argv[reportFlag + 1]) {
    const path = process.argv[reportFlag + 1]!;
    writeFileSync(
      path,
      [
        "# Installation Qualification report",
        "",
        `Generated ${new Date().toISOString()} against \`${process.env.DMOPS_DATABASE_URL ?? "default DMOPS_DATABASE_URL"}\`.`,
        "",
        "| Result | Check | Detail |",
        "| --- | --- | --- |",
        ...results.map((r) => `| ${r.level} | ${r.check} | ${r.detail} |`),
        "",
        `**${failures === 0 ? "IQ PASSED" : "IQ FAILED"}** — ${results.length} checks, ${failures} failed, ${warnings} warnings.`,
        "",
        "Reviewed by: ______________________  Date: ____________",
        "",
      ].join("\n"),
    );
    console.log(`report written to ${path}`);
  }
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
