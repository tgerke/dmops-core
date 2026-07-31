import type { Sql } from "@dmops/db";

/**
 * Read side of lock-readiness (ADR-0014). Read-only by construction: the
 * checklist is the depends_on closure of CLOSE.LOCK derived in
 * v_study_lock_gate / v_study_lock_readiness (migrations/0007), so the only
 * way to move the score is to move the milestones themselves.
 */

export interface LockGateRow {
  study_id: string;
  code: string;
  label: string;
  phase_group: string;
  sequence: number;
  occurrence: number | null;
  status: string | null;
  baseline_date: string | null;
  planned_date: string | null;
  forecast_date: string | null;
  actual_date: string | null;
  blocker_note: string | null;
  evidence_uri: string | null;
  satisfied: boolean;
  applicable: boolean;
}

export interface LockReadinessSummary {
  study_id: string;
  gates_applicable: number;
  gates_satisfied: number;
  gates_blocked: number;
  readiness_pct: string | null;
  next_gate_code: string | null;
  next_gate_label: string | null;
  lock_planned_date: string | null;
  lock_forecast_date: string | null;
  lock_actual_date: string | null;
  open_queries: number | null;
  open_queries_as_of: string | null;
  uat_open_cycles: number | null;
  uat_unresolved_defects: number | null;
  training_gaps: number | null;
}

/** A named disagreement between an asserted gate and live evidence. */
export interface EvidenceConflict {
  gate: string;
  signal: string;
  detail: string;
}

export interface LockReadiness {
  summary: LockReadinessSummary;
  gates: LockGateRow[];
  conflicts: EvidenceConflict[];
}

export async function lockReadiness(sql: Sql, studyId: string): Promise<LockReadiness | null> {
  const [summary] = await sql`
    SELECT * FROM v_study_lock_readiness WHERE study_id = ${studyId}`;
  if (!summary) return null;
  const gates = await sql`
    SELECT study_id, code, label, phase_group, sequence, occurrence, status,
           baseline_date, planned_date, forecast_date, actual_date,
           blocker_note, evidence_uri, satisfied, applicable
    FROM v_study_lock_gate
    WHERE study_id = ${studyId}
    ORDER BY sequence`;
  const typedSummary = summary as unknown as LockReadinessSummary;
  const typedGates = gates as unknown as LockGateRow[];

  // Evidence beside the assertion (ADR-0014): the score is never lowered by
  // a signal — a disagreement is named instead.
  const conflicts: EvidenceConflict[] = [];
  const queryGate = typedGates.find((g) => g.code === "CLOSE.QUERY");
  if (
    queryGate?.satisfied &&
    typedSummary.open_queries !== null &&
    Number(typedSummary.open_queries) > 0
  ) {
    conflicts.push({
      gate: "CLOSE.QUERY",
      signal: "open_queries",
      detail: `CLOSE.QUERY is asserted complete, but the latest query_open_aging snapshot shows ${typedSummary.open_queries} open queries as of ${typedSummary.open_queries_as_of}`,
    });
  }

  return { summary: typedSummary, gates: typedGates, conflicts };
}
