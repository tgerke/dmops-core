import type { Sql } from "@dmops/db";
import { type Actor, withActor } from "./actor.js";

export interface BoardRow {
  id: string;
  study_id: string;
  code: string;
  occurrence: number;
  label: string;
  phase_group: string;
  sequence: number;
  is_repeating: boolean;
  baseline_date: string | null;
  planned_date: string | null;
  forecast_date: string | null;
  actual_date: string | null;
  status: string;
  owner_id: string | null;
  owner_name: string | null;
  blocker_note: string | null;
  evidence_uri: string | null;
  forecast_slip_days: number | null;
  actual_slip_days: number | null;
  rebaseline_count: number;
  last_rebaselined_at: string | null;
  updated_at: string;
}

export async function milestoneBoard(sql: Sql, studyId: string): Promise<BoardRow[]> {
  const rows = await sql`
    SELECT * FROM v_study_milestone_board
    WHERE study_id = ${studyId}
    ORDER BY sequence, occurrence`;
  return rows as unknown as BoardRow[];
}

/**
 * The writable surface of a study milestone. baseline_date and planned_date
 * are deliberately absent: re-baselining is a governance action, not an edit
 * (ADR-0008).
 */
export interface MilestonePatch {
  forecast_date?: string | null;
  actual_date?: string | null;
  status?: "not_started" | "in_progress" | "complete" | "blocked" | "na";
  blocker_note?: string | null;
  evidence_uri?: string | null;
  owner_id?: string | null;
}

export class MilestoneError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export async function updateMilestone(
  sql: Sql,
  actor: Actor,
  input: { studyId: string; code: string; occurrence: number; patch: MilestonePatch },
): Promise<BoardRow> {
  const { studyId, code, occurrence, patch } = input;
  const allowed = new Set([
    "forecast_date",
    "actual_date",
    "status",
    "blocker_note",
    "evidence_uri",
    "owner_id",
  ]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new MilestoneError("invalid", `field '${key}' is not writable through this operation`);
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new MilestoneError("invalid", "empty patch");
  }

  return withActor(sql, actor, async (tx) => {
    const [updated] = await tx`
      UPDATE study_milestone
      SET ${tx(patch as Record<string, string | null>)}, updated_at = now()
      WHERE study_id = ${studyId} AND code = ${code} AND occurrence = ${occurrence}
      RETURNING id`;
    if (!updated) {
      throw new MilestoneError(
        "not_found",
        `milestone ${code} (occurrence ${occurrence}) not found on study`,
      );
    }
    const [row] = await tx`
      SELECT * FROM v_study_milestone_board
      WHERE id = ${updated.id as string}`;
    return row as unknown as BoardRow;
  });
}

// ---------------------------------------------------------------------------
// Re-baselining (ADR-0009): appends an immutable governance record and moves
// planned_date in the same audited transaction. baseline_date never moves.
// ---------------------------------------------------------------------------

export interface RebaselineInput {
  studyId: string;
  code: string;
  occurrence: number;
  newPlannedDate: string;
  reason: string;
  referenceUri?: string | null;
}

export interface RebaselineRecord {
  rebaseline_number: number;
  previous_planned_date: string | null;
  new_planned_date: string;
  reason: string;
  reference_uri: string | null;
  created_at: string;
}

export async function rebaselineMilestone(
  sql: Sql,
  actor: Actor,
  input: RebaselineInput,
): Promise<{ milestone: BoardRow; rebaseline: RebaselineRecord }> {
  const { studyId, code, occurrence, newPlannedDate, reason, referenceUri } = input;
  if (reason.trim().length < 10) {
    throw new MilestoneError("invalid", "a re-baseline requires a substantive reason (ADR-0009)");
  }
  return withActor(sql, actor, async (tx) => {
    // FOR UPDATE serializes concurrent re-baselines of the same milestone, so
    // the count-derived rebaseline_number cannot collide.
    const [ms] = await tx`
      SELECT id, status, planned_date FROM study_milestone
      WHERE study_id = ${studyId} AND code = ${code} AND occurrence = ${occurrence}
      FOR UPDATE`;
    if (!ms) {
      throw new MilestoneError(
        "not_found",
        `milestone ${code} (occurrence ${occurrence}) not found on study`,
      );
    }
    if (ms.status === "complete" || ms.status === "na") {
      throw new MilestoneError(
        "invalid",
        `a ${ms.status} milestone cannot be re-baselined (ADR-0009)`,
      );
    }
    const [seq] = await tx`
      SELECT count(*)::int + 1 AS n FROM milestone_rebaseline
      WHERE study_milestone_id = ${ms.id as string}`;
    const [record] = await tx`
      INSERT INTO milestone_rebaseline
        (study_milestone_id, rebaseline_number, previous_planned_date,
         new_planned_date, reason, reference_uri)
      VALUES
        (${ms.id as string}, ${seq!.n as number}, ${ms.planned_date as string | null},
         ${newPlannedDate}, ${reason}, ${referenceUri ?? null})
      RETURNING rebaseline_number, previous_planned_date, new_planned_date,
                reason, reference_uri, created_at`;
    await tx`
      UPDATE study_milestone SET planned_date = ${newPlannedDate}, updated_at = now()
      WHERE id = ${ms.id as string}`;
    const [row] = await tx`
      SELECT * FROM v_study_milestone_board
      WHERE id = ${ms.id as string}`;
    return {
      milestone: row as unknown as BoardRow,
      rebaseline: record as unknown as RebaselineRecord,
    };
  });
}

export async function rebaselineHistory(
  sql: Sql,
  studyId: string,
  code: string,
  occurrence: number,
): Promise<RebaselineRecord[] | null> {
  const [ms] = await sql`
    SELECT id FROM study_milestone
    WHERE study_id = ${studyId} AND code = ${code} AND occurrence = ${occurrence}`;
  if (!ms) return null;
  const rows = await sql`
    SELECT rebaseline_number, previous_planned_date, new_planned_date,
           reason, reference_uri, created_at
    FROM milestone_rebaseline
    WHERE study_milestone_id = ${ms.id as string}
    ORDER BY rebaseline_number`;
  return rows as unknown as RebaselineRecord[];
}
