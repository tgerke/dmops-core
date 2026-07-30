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
 * Deliverable status writes: the same DM-leadership rule as milestones today,
 * as a named export so the rules can diverge without a hunt.
 */
export function canWriteDeliverables(assignments: Assignment[], studyId: string): boolean {
  return canWriteMilestones(assignments, studyId);
}

/**
 * UAT writes (ADR-0010): DM leadership plus analysts assigned to the study —
 * the taxonomy's default owner for UAT.START/UAT.COMPLETE is analyst, and
 * DM-P6 keeps data entry where the work happens. Deliberately wider than
 * canWriteMilestones; milestone status stays a leadership assertion.
 */
export function canWriteUat(assignments: Assignment[], studyId: string): boolean {
  return (
    canWriteMilestones(assignments, studyId) ||
    assignments.some((a) => a.studyId === studyId && a.role === "analyst")
  );
}

/**
 * Deliverable types owned by the analysis phase (ADR-0011); status writes on
 * these accept the analysis predicate. sdtm_spec stays DM: SPEC.SDTM is a
 * dm-module startup milestone.
 */
export const ANALYSIS_DELIVERABLE_TYPES: ReadonlySet<string> = new Set([
  "sap",
  "adam_spec",
  "tlf_shells",
]);

/**
 * Analysis-phase writes (ADR-0011): DM leadership plus programmer or biostat
 * assigned to the study — the taxonomy's default owners for STAT.* codes, and
 * DM-P6 keeps data entry where the work happens. Applies to analysis-phase
 * milestones and analysis deliverable types; DM-phase milestones remain
 * leadership-only via canWriteMilestones.
 */
export function canWriteAnalysis(assignments: Assignment[], studyId: string): boolean {
  return (
    canWriteMilestones(assignments, studyId) ||
    assignments.some(
      (a) => a.studyId === studyId && (a.role === "programmer" || a.role === "biostat"),
    )
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
