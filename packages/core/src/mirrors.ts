import type { Sql } from "@dmops/db";

/**
 * Read side of the roster mirrors (ADR-0013). Read-only by construction:
 * the mirrors are written only by the refresh pipeline, and dmops_app holds
 * SELECT alone, so there is no update function to omit here.
 */

export interface RosterRow {
  study_id: string;
  person_key: string;
  person_name: string | null;
  roles: string[];
  site_keys: string[] | null;
  account_status: "active" | "locked" | "deactivated";
  first_granted_at: string | null;
  mirrored_at: string;
  trainings_on_file: number;
  trainings_current: number;
  trainings_overdue: number;
  trainings_expired: number;
  trainings_pending: number;
  training_gap: boolean;
}

export type TrainingStatus = "current" | "expired" | "overdue" | "pending";

export interface TrainingStatusRow {
  study_id: string;
  person_key: string;
  person_name: string | null;
  course_key: string;
  course_title: string | null;
  due_date: string | null;
  completed_date: string | null;
  expires_date: string | null;
  mirrored_at: string;
  status: TrainingStatus;
}

/** Gaps first, then alphabetical — the roster is triage, not a directory. */
export async function accessRoster(sql: Sql, studyId: string): Promise<RosterRow[]> {
  const rows = await sql`
    SELECT * FROM v_study_access_roster
    WHERE study_id = ${studyId}
    ORDER BY training_gap DESC, person_name NULLS LAST, person_key`;
  return rows as unknown as RosterRow[];
}

export async function trainingStatus(sql: Sql, studyId: string): Promise<TrainingStatusRow[]> {
  const rows = await sql`
    SELECT study_id, person_key, person_name, course_key, course_title,
           due_date, completed_date, expires_date, mirrored_at, status
    FROM v_study_training_status
    WHERE study_id = ${studyId}
    ORDER BY person_name NULLS LAST, person_key, course_key`;
  return rows as unknown as TrainingStatusRow[];
}
