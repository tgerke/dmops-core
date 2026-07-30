import { z } from "zod";

/**
 * Normalized frames (ADR-0005): the shape every source adapter emits,
 * whatever the source system. Transport-plain JSON — snake_case keys,
 * ISO 8601 strings — so a CSV file and an HTTP API produce identical rows.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const isoDateTime = z.string().datetime({ offset: true });

export const queryRow = z
  .object({
    source_query_id: z.string().min(1),
    site_key: z.string().nullable(),
    subject_key: z.string().nullable(),
    form_key: z.string().nullable(),
    origin: z.enum(["manual", "system"]).nullable(),
    status: z.enum(["open", "answered", "closed", "cancelled"]),
    opened_at: isoDateTime,
    first_response_at: isoDateTime.nullable(),
    closed_at: isoDateTime.nullable(),
  })
  .strict();

export const subjectRow = z
  .object({
    subject_key: z.string().min(1),
    site_key: z.string().nullable(),
    status: z.enum(["screening", "enrolled", "completed", "withdrawn", "screen_failed"]),
    enrolled_date: isoDate.nullable(),
  })
  .strict();

export const visitRow = z
  .object({
    subject_key: z.string().min(1),
    visit_key: z.string().min(1),
    visit_date: isoDate.nullable(),
    occurred: z.boolean(),
  })
  .strict();

export const pageRow = z
  .object({
    subject_key: z.string().min(1),
    visit_key: z.string().nullable(),
    form_key: z.string().min(1),
    status: z.enum(["not_started", "in_progress", "complete", "locked"]),
    first_entered_at: isoDateTime.nullable(),
    sdv_status: z.enum(["not_required", "pending", "verified"]).nullable(),
  })
  .strict();

/**
 * Repository-work frames (ADR-0012): normalized vocabulary owned by
 * dmops-core, not a mirror of any host's payload — exactly as `queries` is
 * not a Medrio or Rave shape. Source ids are strings even when the host uses
 * integers; `repo_key` scopes them, since issue and PR numbers repeat across
 * repositories.
 */
export const issueRow = z
  .object({
    source_issue_id: z.string().min(1),
    repo_key: z.string().min(1),
    state: z.enum(["open", "closed"]),
    opened_at: isoDateTime,
    closed_at: isoDateTime.nullable(),
  })
  .strict();

export const pullRequestRow = z
  .object({
    source_pr_id: z.string().min(1),
    repo_key: z.string().min(1),
    state: z.enum(["open", "merged", "closed"]),
    opened_at: isoDateTime,
    merged_at: isoDateTime.nullable(),
    closed_at: isoDateTime.nullable(),
  })
  .strict();

// Only submitted reviews: a pending (unsubmitted) review is not review
// activity and has no submitted timestamp, so it never enters the frame.
export const reviewRow = z
  .object({
    source_review_id: z.string().min(1),
    source_pr_id: z.string().min(1),
    repo_key: z.string().min(1),
    reviewer_key: z.string().min(1),
    state: z.enum(["approved", "changes_requested", "commented", "dismissed"]),
    submitted_at: isoDateTime,
  })
  .strict();

/**
 * Roster frames (ADR-0013): mirrors of the LMS transcript and the source
 * system's user administration — displayed with provenance, never the
 * record (ADR-0006). `person_key` is the source system's identity, by
 * convention an email address, so training and access rows join across
 * sources; there is deliberately no link to this system's `person` table.
 */
export const trainingRecordRow = z
  .object({
    person_key: z.string().min(1),
    person_name: z.string().nullable(),
    course_key: z.string().min(1),
    course_title: z.string().nullable(),
    due_date: isoDate.nullable(),
    completed_date: isoDate.nullable(),
    expires_date: isoDate.nullable(),
  })
  .strict();

// Current grants only: a roster is a statement about now, and revocation
// history stays in the source system's own audit trail (ADR-0013).
export const accessGrantRow = z
  .object({
    person_key: z.string().min(1),
    person_name: z.string().nullable(),
    role_key: z.string().min(1),
    /** Null means a study-wide grant, not an unknown site. */
    site_key: z.string().nullable(),
    status: z.enum(["active", "locked", "deactivated"]),
    granted_at: isoDateTime.nullable(),
  })
  .strict();

export const frameSchemas = {
  queries: queryRow,
  subjects: subjectRow,
  visits: visitRow,
  pages: pageRow,
  issues: issueRow,
  pull_requests: pullRequestRow,
  reviews: reviewRow,
  training_records: trainingRecordRow,
  access_grants: accessGrantRow,
} as const;

export type FrameName = keyof typeof frameSchemas;
export const frameNames = Object.keys(frameSchemas) as FrameName[];

export type QueryRow = z.infer<typeof queryRow>;
export type SubjectRow = z.infer<typeof subjectRow>;
export type VisitRow = z.infer<typeof visitRow>;
export type PageRow = z.infer<typeof pageRow>;
export type IssueRow = z.infer<typeof issueRow>;
export type PullRequestRow = z.infer<typeof pullRequestRow>;
export type ReviewRow = z.infer<typeof reviewRow>;
export type TrainingRecordRow = z.infer<typeof trainingRecordRow>;
export type AccessGrantRow = z.infer<typeof accessGrantRow>;

export interface NormalizedFrames {
  queries?: QueryRow[];
  subjects?: SubjectRow[];
  visits?: VisitRow[];
  pages?: PageRow[];
  issues?: IssueRow[];
  pull_requests?: PullRequestRow[];
  reviews?: ReviewRow[];
  training_records?: TrainingRecordRow[];
  access_grants?: AccessGrantRow[];
}
