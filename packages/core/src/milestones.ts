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
