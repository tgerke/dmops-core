import type { Sql } from "@dmops/db";
import { type Actor, withActor } from "./actor.js";

export type UatCycleStatus = "planned" | "in_progress" | "complete" | "cancelled";
export type UatDefectStatus = "open" | "resolved" | "closed" | "withdrawn";
export type UatDefectSeverity = "critical" | "major" | "minor";

export interface UatCycleRow {
  id: string;
  study_id: string;
  cycle_number: number;
  title: string;
  status: UatCycleStatus;
  started_date: string | null;
  completed_date: string | null;
  scripts_planned: number | null;
  scripts_executed: number | null;
  evidence_uri: string | null;
  updated_at: string;
  open_defects: number;
  resolved_defects: number;
  closed_defects: number;
  withdrawn_defects: number;
  total_defects: number;
}

export interface UatDefectRow {
  id: string;
  cycle_id: string;
  defect_number: number;
  title: string;
  severity: UatDefectSeverity;
  status: UatDefectStatus;
  raised_date: string;
  resolved_date: string | null;
  resolution_note: string | null;
  reference_uri: string | null;
  updated_at: string;
}

/**
 * The writable surface of a UAT cycle. title and study_id are identity, not
 * status — a different round of UAT is a new row. Per-script execution
 * records are deliberately absent: the executed package lives in the
 * validated system and the eTMF; counts + evidence_uri mirror it here
 * (ADR-0010, ADR-0006).
 */
export interface UatCyclePatch {
  status?: UatCycleStatus;
  started_date?: string | null;
  completed_date?: string | null;
  scripts_planned?: number | null;
  scripts_executed?: number | null;
  evidence_uri?: string | null;
}

/**
 * The writable surface of a defect. title is identity — a different finding
 * is a new row (ADR-0010).
 */
export interface UatDefectPatch {
  status?: UatDefectStatus;
  severity?: UatDefectSeverity;
  resolved_date?: string | null;
  resolution_note?: string | null;
  reference_uri?: string | null;
}

export class UatError extends Error {
  constructor(
    readonly code: "not_found" | "invalid",
    message: string,
  ) {
    super(message);
  }
}

export async function listUatCycles(sql: Sql, studyId: string): Promise<UatCycleRow[]> {
  const rows = await sql`
    SELECT * FROM v_uat_cycle WHERE study_id = ${studyId} ORDER BY cycle_number`;
  return rows as unknown as UatCycleRow[];
}

export async function createUatCycle(
  sql: Sql,
  actor: Actor,
  input: {
    studyId: string;
    title: string;
    startedDate?: string | null;
    scriptsPlanned?: number | null;
  },
): Promise<UatCycleRow> {
  const { studyId, title, startedDate, scriptsPlanned } = input;
  if (!title.trim()) {
    throw new UatError("invalid", "a cycle requires a title");
  }
  return withActor(sql, actor, async (tx) => {
    // FOR UPDATE on the study serializes concurrent cycle creation, so the
    // count-derived cycle_number cannot collide (rebaseline pattern, ADR-0009).
    const [study] = await tx`SELECT id FROM study WHERE id = ${studyId} FOR UPDATE`;
    if (!study) {
      throw new UatError("not_found", "study not found");
    }
    const [seq] = await tx`
      SELECT count(*)::int + 1 AS n FROM uat_cycle WHERE study_id = ${studyId}`;
    const [inserted] = await tx`
      INSERT INTO uat_cycle
        (study_id, cycle_number, title, status, started_date, scripts_planned)
      VALUES
        (${studyId}, ${seq!.n as number}, ${title},
         ${startedDate ? "in_progress" : "planned"}, ${startedDate ?? null},
         ${scriptsPlanned ?? null})
      RETURNING id`;
    const [row] = await tx`SELECT * FROM v_uat_cycle WHERE id = ${inserted!.id as string}`;
    return row as unknown as UatCycleRow;
  });
}

export async function updateUatCycle(
  sql: Sql,
  actor: Actor,
  input: { studyId: string; cycleId: string; patch: UatCyclePatch },
): Promise<UatCycleRow> {
  const { studyId, cycleId, patch } = input;
  const allowed = new Set([
    "status",
    "started_date",
    "completed_date",
    "scripts_planned",
    "scripts_executed",
    "evidence_uri",
  ]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new UatError("invalid", `field '${key}' is not writable through this operation`);
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new UatError("invalid", "empty patch");
  }

  return withActor(sql, actor, async (tx) => {
    const [current] = await tx`
      SELECT status, started_date, completed_date FROM uat_cycle
      WHERE id = ${cycleId} AND study_id = ${studyId}
      FOR UPDATE`;
    if (!current) {
      throw new UatError("not_found", "UAT cycle not found on this study");
    }
    const startedDate =
      "started_date" in patch ? patch.started_date : (current.started_date as string | null);
    if ((patch.status === "in_progress" || patch.status === "complete") && !startedDate) {
      throw new UatError("invalid", "a cycle in progress requires a started_date");
    }
    if (patch.status === "complete") {
      // Endings are dated facts, and the taxonomy label is literal:
      // UAT.COMPLETE means defects resolved (ADR-0010).
      const completedDate =
        "completed_date" in patch
          ? patch.completed_date
          : (current.completed_date as string | null);
      if (!completedDate) {
        throw new UatError("invalid", "a complete cycle requires a completed_date");
      }
      const [unresolved] = await tx`
        SELECT count(*)::int AS n FROM uat_defect
        WHERE cycle_id = ${cycleId} AND status IN ('open', 'resolved')`;
      if ((unresolved!.n as number) > 0) {
        throw new UatError(
          "invalid",
          `UAT.COMPLETE means defects resolved: ${unresolved!.n} defect(s) still open or awaiting retest (ADR-0010)`,
        );
      }
    }
    await tx`
      UPDATE uat_cycle
      SET ${tx(patch as Record<string, string | number | null>)}, updated_at = now()
      WHERE id = ${cycleId} AND study_id = ${studyId}`;
    const [row] = await tx`SELECT * FROM v_uat_cycle WHERE id = ${cycleId}`;
    return row as unknown as UatCycleRow;
  });
}

/** Defects for a cycle; null when the cycle is not on this study (→ 404). */
export async function listUatDefects(
  sql: Sql,
  studyId: string,
  cycleId: string,
): Promise<UatDefectRow[] | null> {
  const [cycle] = await sql`
    SELECT id FROM uat_cycle WHERE id = ${cycleId} AND study_id = ${studyId}`;
  if (!cycle) return null;
  const rows = await sql`
    SELECT id, cycle_id, defect_number, title, severity, status, raised_date,
           resolved_date, resolution_note, reference_uri, updated_at
    FROM uat_defect
    WHERE cycle_id = ${cycleId}
    ORDER BY defect_number`;
  return rows as unknown as UatDefectRow[];
}

export async function createUatDefect(
  sql: Sql,
  actor: Actor,
  input: {
    studyId: string;
    cycleId: string;
    title: string;
    severity: UatDefectSeverity;
    raisedDate?: string | null;
    referenceUri?: string | null;
  },
): Promise<UatDefectRow> {
  const { studyId, cycleId, title, severity, raisedDate, referenceUri } = input;
  if (!title.trim()) {
    throw new UatError("invalid", "a defect requires a title");
  }
  return withActor(sql, actor, async (tx) => {
    // FOR UPDATE serializes concurrent defect creation on the cycle, so the
    // count-derived defect_number cannot collide.
    const [cycle] = await tx`
      SELECT status FROM uat_cycle
      WHERE id = ${cycleId} AND study_id = ${studyId}
      FOR UPDATE`;
    if (!cycle) {
      throw new UatError("not_found", "UAT cycle not found on this study");
    }
    if (cycle.status === "complete" || cycle.status === "cancelled") {
      throw new UatError("invalid", "defects are raised against an active cycle");
    }
    const [seq] = await tx`
      SELECT count(*)::int + 1 AS n FROM uat_defect WHERE cycle_id = ${cycleId}`;
    const [row] = await tx`
      INSERT INTO uat_defect
        (cycle_id, defect_number, title, severity, raised_date, reference_uri)
      VALUES
        (${cycleId}, ${seq!.n as number}, ${title}, ${severity},
         coalesce(${raisedDate ?? null}, CURRENT_DATE), ${referenceUri ?? null})
      RETURNING id, cycle_id, defect_number, title, severity, status, raised_date,
                resolved_date, resolution_note, reference_uri, updated_at`;
    return row as unknown as UatDefectRow;
  });
}

export async function updateUatDefect(
  sql: Sql,
  actor: Actor,
  input: { studyId: string; cycleId: string; defectId: string; patch: UatDefectPatch },
): Promise<UatDefectRow> {
  const { studyId, cycleId, defectId, patch } = input;
  const allowed = new Set([
    "status",
    "severity",
    "resolved_date",
    "resolution_note",
    "reference_uri",
  ]);
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) {
      throw new UatError("invalid", `field '${key}' is not writable through this operation`);
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new UatError("invalid", "empty patch");
  }

  return withActor(sql, actor, async (tx) => {
    const [current] = await tx`
      SELECT d.resolved_date, d.resolution_note FROM uat_defect d
      JOIN uat_cycle c ON c.id = d.cycle_id
      WHERE d.id = ${defectId} AND d.cycle_id = ${cycleId} AND c.study_id = ${studyId}
      FOR UPDATE OF d`;
    if (!current) {
      throw new UatError("not_found", "defect not found on this cycle");
    }
    // Mirror the DB CHECKs so clients get a 400, not a constraint error:
    // endings are dated facts, and closure carries a substantive note.
    const resolvedDate =
      "resolved_date" in patch ? patch.resolved_date : (current.resolved_date as string | null);
    if ((patch.status === "resolved" || patch.status === "closed") && !resolvedDate) {
      throw new UatError("invalid", "a resolved or closed defect requires a resolved_date");
    }
    const note =
      "resolution_note" in patch
        ? patch.resolution_note
        : (current.resolution_note as string | null);
    if (
      (patch.status === "closed" || patch.status === "withdrawn") &&
      (note ?? "").trim().length < 10
    ) {
      throw new UatError(
        "invalid",
        "closing or withdrawing a defect requires a substantive resolution_note",
      );
    }
    await tx`
      UPDATE uat_defect
      SET ${tx(patch as Record<string, string | null>)}, updated_at = now()
      WHERE id = ${defectId}`;
    const [row] = await tx`
      SELECT id, cycle_id, defect_number, title, severity, status, raised_date,
             resolved_date, resolution_note, reference_uri, updated_at
      FROM uat_defect WHERE id = ${defectId}`;
    return row as unknown as UatDefectRow;
  });
}
