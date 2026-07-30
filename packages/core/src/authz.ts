import type { Sql } from "@dmops/db";

export type Role =
  | "dm_lead"
  | "dm_manager"
  | "analyst"
  | "programmer"
  | "clinops"
  | "biostat"
  | "sponsor_user"
  | "qa"
  | "admin";

export interface Assignment {
  studyId: string;
  role: Role;
}

/** Active study assignments for a person (ended assignments excluded). */
export async function assignmentsFor(sql: Sql, personId: string): Promise<Assignment[]> {
  const rows = await sql`
    SELECT study_id, role FROM study_assignment
    WHERE person_id = ${personId}
      AND (end_date IS NULL OR end_date >= CURRENT_DATE)`;
  return rows.map((r) => ({ studyId: r.study_id as string, role: r.role as Role }));
}

/** qa and admin see the whole portfolio; everyone else sees assigned studies. */
export function hasPortfolioRead(assignments: Assignment[]): boolean {
  return assignments.some((a) => a.role === "qa" || a.role === "admin");
}

export function canReadStudy(assignments: Assignment[], studyId: string): boolean {
  return hasPortfolioRead(assignments) || assignments.some((a) => a.studyId === studyId);
}

/** Milestone writes: DM leadership on the study, or an admin assignment. */
export function canWriteMilestones(assignments: Assignment[], studyId: string): boolean {
  return assignments.some(
    (a) =>
      (a.studyId === studyId && (a.role === "dm_lead" || a.role === "dm_manager")) ||
      a.role === "admin",
  );
}

/**
 * Re-baselining (ADR-0009): deliberately stricter than milestone writes —
 * moving the plan is governance, not an edit. dm_lead moves forecasts only.
 */
export function canRebaseline(assignments: Assignment[], studyId: string): boolean {
  return assignments.some(
    (a) => (a.studyId === studyId && a.role === "dm_manager") || a.role === "admin",
  );
}

/**
 * Sponsor scoping (DM-P5, slice-1 down payment on field-level ACL): a person
 * whose only relationship to a study is sponsor_user gets the curated
 * serialization — internal fields like blocker notes are excluded.
 */
export function isSponsorOnly(assignments: Assignment[], studyId: string): boolean {
  const onStudy = assignments.filter((a) => a.studyId === studyId);
  return onStudy.length > 0 && onStudy.every((a) => a.role === "sponsor_user");
}
