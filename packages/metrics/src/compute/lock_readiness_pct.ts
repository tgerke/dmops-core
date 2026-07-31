import type { ComputeFn, MilestoneFact } from "../types.js";

/**
 * lock_readiness_pct v1.0 (ADR-0014): percent of applicable lock gates —
 * the transitive depends_on closure of CLOSE.LOCK in the governed taxonomy
 * (ADR-0008) — with an actual completion date on or before period end.
 * Source is dmops-core's own facts: ctx.milestones plus ctx.definitions
 * (already filtered to the study's enabled modules by the pipeline; inactive
 * codes are skipped here). Grain: study.
 *
 * This closure and the one in v_study_lock_gate (migrations/0007) are two
 * implementations of one derivation; the suite pins both to the same gate
 * list for the shipped taxonomy (DM-Q9).
 */
export const lockReadinessPct: ComputeFn = (_frames, ctx) => {
  const defs = new Map(
    (ctx.definitions ?? []).filter((d) => d.active).map((d) => [d.code, d] as const),
  );
  const gates = new Set<string>();
  const queue = [...(defs.get("CLOSE.LOCK")?.depends_on ?? [])];
  while (queue.length > 0) {
    const code = queue.pop();
    if (code === undefined || gates.has(code)) continue;
    const def = defs.get(code);
    if (!def) continue;
    gates.add(code);
    queue.push(...def.depends_on);
  }

  // Latest occurrence per gate code (the closure holds no repeating codes
  // today; same guard as the view).
  const byCode = new Map<string, MilestoneFact>();
  for (const m of ctx.milestones ?? []) {
    if (!gates.has(m.code)) continue;
    const prev = byCode.get(m.code);
    if (!prev || m.occurrence > prev.occurrence) byCode.set(m.code, m);
  }

  let applicable = 0;
  let satisfied = 0;
  const periodEndExclusive = Date.parse(ctx.periodEnd) + 86_400_000;
  for (const code of gates) {
    const m = byCode.get(code);
    // A gate with no milestone row is applicable and unsatisfied: absence
    // reads as "not done", never "not asked" (ADR-0014).
    if (m?.status === "na") continue;
    applicable++;
    if (m?.actual_date !== null && m?.actual_date !== undefined) {
      if (Date.parse(m.actual_date) < periodEndExclusive) satisfied++;
    }
  }

  return [
    {
      grain: "study",
      site_key: null,
      value: applicable > 0 ? Math.round((1000 * satisfied) / applicable) / 10 : null,
      numerator: applicable > 0 ? satisfied : null,
      denominator: applicable > 0 ? applicable : null,
      n_records: applicable,
    },
  ];
};
