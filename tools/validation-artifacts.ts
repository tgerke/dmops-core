/**
 * Generate validation raw material from a real test run:
 *
 *   docs/validation/oq-report.md      — Operational Qualification evidence:
 *                                       every test, its result, environment
 *   docs/validation/traceability.md   — requirement → mechanism → verifying
 *   docs/validation/traceability.csv    tests, joined from the compliance
 *                                       mapping table and the suite itself
 *
 * The join key is the requirement token (DM-P1..P6 design principles,
 * DM-Q* metric qualification cases, DS-Q* for the stat-module metric
 * dictionary, ADR-0012) appearing verbatim in test names, so the matrix can
 * never silently drift from the suite: an untested requirement shows an
 * empty cell, a renamed test drops out.
 *
 * These files are generated only — never hand-edited (see CLAUDE.md).
 *
 * Usage: pnpm validation:artifacts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "docs", "validation");
const REQUIREMENT_TOKEN = /D[MS]-[PQ]\d+/g;

interface TestCase {
  file: string;
  fullName: string;
  status: string;
  duration: number;
}

function runSuite(): { tests: TestCase[]; success: boolean } {
  let stdout: string;
  try {
    stdout = execFileSync("pnpm", ["exec", "vitest", "run", "--reporter=json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    // vitest exits non-zero on test failure but still emits the JSON report
    stdout = (e as { stdout?: string }).stdout ?? "";
  }
  const jsonStart = stdout.indexOf('{"numTotalTestSuites"');
  if (jsonStart === -1) throw new Error("vitest produced no JSON report");
  const report = JSON.parse(stdout.slice(jsonStart)) as {
    success: boolean;
    testResults: {
      name: string;
      assertionResults: { fullName: string; status: string; duration?: number }[];
    }[];
  };
  const tests = report.testResults.flatMap((suite) =>
    suite.assertionResults.map((test) => ({
      file: suite.name.replace(`${ROOT}/`, ""),
      fullName: test.fullName,
      status: test.status,
      duration: test.duration ?? 0,
    })),
  );
  return { tests, success: report.success };
}

interface Requirement {
  id: string;
  requirement: string;
  mechanism: string;
  where: string;
}

/** Parse the requirement mapping table out of docs/03-compliance.md. */
function parseComplianceTable(): Requirement[] {
  const md = readFileSync(join(ROOT, "docs", "03-compliance.md"), "utf8");
  const requirements: Requirement[] = [];
  for (const line of md.split("\n")) {
    if (!line.startsWith("| DM-")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const [id] = cells[1]!.match(REQUIREMENT_TOKEN) ?? [];
    if (!id) continue;
    requirements.push({
      id,
      requirement: cells[1]!,
      mechanism: cells[2] ?? "",
      where: cells[3] ?? "",
    });
  }
  if (requirements.length === 0) {
    throw new Error("no requirement rows found in docs/03-compliance.md — table format changed?");
  }
  // DM-Q*/DS-Q* qualification cases: one per (metric, version) in the
  // governed dictionary — past or present — enumerated here so a metric
  // version without a fixture test shows as a hole. Tokens are permanent: a
  // retired version keeps its token and its history-pinning test (ADR-0004).
  // DS-Q is its own series (ADR-0012): the stat-module dictionary stays
  // legible in the matrix and DM-Q remains a closed enumeration.
  const qualification: Requirement[] = (
    [
      ["DM-Q1", "query_tat_median", "v1.0 (calendar days)"],
      ["DM-Q2", "query_open_aging", "v1.0"],
      ["DM-Q3", "entry_lag", "v1.0 (calendar days)"],
      ["DM-Q4", "milestone_slip", "v1.0"],
      ["DM-Q5", "query_tat_median", "v1.1 (business days)"],
      ["DM-Q6", "entry_lag", "v1.1 (business days)"],
      ["DS-Q1", "pr_review_tat_median", "v1.0 (business days)"],
      ["DS-Q2", "pr_cycle_time_median", "v1.0 (business days)"],
      ["DS-Q3", "issue_closure_lag_median", "v1.0 (calendar days)"],
      ["DS-Q4", "issue_open_aging", "v1.0"],
    ] as const
  ).map(([id, metric, version]) => ({
    id,
    requirement: `${id} — ${metric} ${version} matches hand-computed expected values`,
    mechanism: "Pure compute function tested against fixtures/study-DMOPS-001/expected-values.json",
    where: `metrics/${metric}.yaml, packages/metrics/src/compute/${metric}.ts`,
  }));
  return [...requirements, ...qualification];
}

function environment(): string {
  const git = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
  return `commit ${git}, node ${process.version}, ${new Date().toISOString()}`;
}

function main() {
  const { tests, success } = runSuite();
  const requirements = parseComplianceTable();
  const env = environment();
  mkdirSync(OUT, { recursive: true });

  // --- OQ report --------------------------------------------------------------
  const byFile = new Map<string, TestCase[]>();
  for (const t of tests) {
    byFile.set(t.file, [...(byFile.get(t.file) ?? []), t]);
  }
  const passed = tests.filter((t) => t.status === "passed").length;
  const oq: string[] = [
    "# Operational Qualification report",
    "",
    `Environment: ${env}`,
    "",
    `Suite result: **${success ? "PASSED" : "FAILED"}** — ${passed}/${tests.length} tests passed.`,
    "",
  ];
  for (const [file, cases] of byFile) {
    oq.push(`## ${file}`, "", "| Result | Test | ms |", "| --- | --- | ---: |");
    for (const t of cases) {
      oq.push(
        `| ${t.status === "passed" ? "PASS" : t.status.toUpperCase()} | ${t.fullName} | ${Math.round(t.duration)} |`,
      );
    }
    oq.push("");
  }
  oq.push("Reviewed by: ______________________  Date: ____________", "");
  writeFileSync(join(OUT, "oq-report.md"), oq.join("\n"));

  // --- traceability matrix ----------------------------------------------------
  const matrix = requirements.map((req) => ({
    ...req,
    tests: tests.filter((t) => t.fullName.includes(req.id)),
  }));
  const md: string[] = [
    "# Requirement traceability matrix",
    "",
    `Generated from a live test run (${env}); regenerate with \`pnpm validation:artifacts\`.`,
    "Join key: the requirement token appearing verbatim in test names, so this",
    "matrix cannot drift from the suite without showing it.",
    "",
    "| Requirement | Mechanism | Verifying tests | Result |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of matrix) {
    const names = row.tests.map((t) => t.fullName).join("<br>");
    const result =
      row.tests.length === 0
        ? "—"
        : row.tests.every((t) => t.status === "passed")
          ? "PASS"
          : "FAIL";
    md.push(
      `| ${row.requirement} | ${row.mechanism} | ${names || "*(no automated test)*"} | ${result} |`,
    );
  }
  const untested = matrix.filter((r) => r.tests.length === 0).map((r) => r.id);
  md.push(
    "",
    untested.length
      ? `Requirements without automated verification: ${untested.join(", ")} — see the mechanism column and docs/03-compliance.md for their status.`
      : "Every mapped requirement has at least one automated verification.",
    "",
  );
  writeFileSync(join(OUT, "traceability.md"), md.join("\n"));

  const csv = [
    "requirement_id,requirement,mechanism,test_file,test_name,status",
    ...matrix.flatMap((row) =>
      row.tests.length === 0
        ? [
            `"${row.id}","${row.requirement.replaceAll('"', '""')}","${row.mechanism.replaceAll('"', '""')}","","",""`,
          ]
        : row.tests.map(
            (t) =>
              `"${row.id}","${row.requirement.replaceAll('"', '""')}","${row.mechanism.replaceAll('"', '""')}","${t.file}","${t.fullName.replaceAll('"', '""')}","${t.status}"`,
          ),
    ),
  ];
  writeFileSync(join(OUT, "traceability.csv"), `${csv.join("\n")}\n`);

  console.log(`OQ: ${passed}/${tests.length} tests passed → docs/validation/oq-report.md`);
  console.log(
    `Traceability: ${matrix.length} requirements, ${matrix.length - untested.length} with automated tests → docs/validation/traceability.{md,csv}`,
  );
  if (!success) process.exit(1);
}

main();
