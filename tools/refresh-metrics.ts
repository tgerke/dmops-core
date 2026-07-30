import { refreshStudyMetrics } from "@dmops/core";
/**
 * Metric refresh CLI: run the snapshot pipeline for one study or the whole
 * portfolio. Stateless and cron-friendly — schedule it with cron or your
 * platform's scheduler; there is deliberately no write endpoint for this in
 * the API (DM-P6).
 *
 * Usage:
 *   pnpm metrics:refresh                       # all studies, previous full month
 *   pnpm metrics:refresh --study DMOPS-001
 *   pnpm metrics:refresh --period 2026-06      # a specific calendar month
 */
import { createDb } from "@dmops/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function monthPeriod(yyyyMm?: string): { periodStart: string; periodEnd: string } {
  let year: number;
  let month: number; // 1-12
  if (yyyyMm) {
    const m = yyyyMm.match(/^(\d{4})-(\d{2})$/);
    if (!m) throw new Error("--period must be YYYY-MM");
    year = Number(m[1]);
    month = Number(m[2]);
  } else {
    const now = new Date();
    year = now.getUTCFullYear();
    month = now.getUTCMonth(); // previous month (getUTCMonth is 0-based)
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    periodStart: `${year}-${pad(month)}-01`,
    periodEnd: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

const { sql } = createDb();
const period = monthPeriod(arg("period"));
const protocol = arg("study");

const studies = protocol
  ? await sql`SELECT id, protocol_number FROM study WHERE protocol_number = ${protocol}`
  : await sql`SELECT id, protocol_number FROM study ORDER BY protocol_number`;
if (studies.length === 0) {
  console.error(protocol ? `no study ${protocol}` : "no studies");
  process.exit(1);
}

console.log(`refreshing metrics for ${period.periodStart} .. ${period.periodEnd}`);
for (const study of studies) {
  const result = await refreshStudyMetrics(sql, study.id as string, period);
  console.log(
    `${study.protocol_number}: ${result.computed.length} computed, ${result.skipped.length} skipped`,
  );
  for (const s of result.skipped) console.log(`  skipped ${s.metricId} — ${s.reason}`);
  for (const w of result.warnings) console.log(`  warning: ${w}`);
}
await sql.end();
