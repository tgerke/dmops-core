import { z } from "@hono/zod-openapi";

export const ErrorSchema = z.object({ error: z.string() });

export const StudySummarySchema = z.object({
  study_id: z.string().uuid(),
  protocol_number: z.string(),
  short_title: z.string().nullable(),
  phase: z.string().nullable(),
  indication: z.string().nullable(),
  study_status: z.string(),
  sponsor_name: z.string().nullable(),
  dm_lead_name: z.string().nullable(),
  milestone_total: z.number(),
  milestone_complete: z.number(),
  milestone_blocked: z.number(),
  milestone_in_progress: z.number(),
  milestone_na: z.number(),
  pct_complete: z.number().nullable(),
  next_milestone_code: z.string().nullable(),
  next_milestone_label: z.string().nullable(),
  next_milestone_planned: z.string().nullable(),
});

export const StudyDetailSchema = StudySummarySchema.extend({
  therapeutic_area: z.string().nullable(),
  source: z
    .object({
      adapter: z.string(),
      source_study_key: z.string(),
      last_extract_at: z.string().nullable(),
      last_extract_status: z.string().nullable(),
    })
    .nullable(),
});

// blocker_note is optional because the sponsor serialization omits it
// entirely (DM-P5) — a curated view, not a blanked field.
export const BoardRowSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  occurrence: z.number(),
  label: z.string(),
  phase_group: z.string(),
  sequence: z.number(),
  is_repeating: z.boolean(),
  baseline_date: z.string().nullable(),
  planned_date: z.string().nullable(),
  forecast_date: z.string().nullable(),
  actual_date: z.string().nullable(),
  status: z.string(),
  owner_id: z.string().nullable(),
  owner_name: z.string().nullable(),
  blocker_note: z.string().nullable().optional(),
  evidence_uri: z.string().nullable(),
  forecast_slip_days: z.number().nullable(),
  actual_slip_days: z.number().nullable(),
  rebaseline_count: z.number(),
  last_rebaselined_at: z.string().nullable(),
  updated_at: z.string(),
});

export const MilestoneBoardSchema = z.object({
  study_id: z.string().uuid(),
  milestones: z.array(BoardRowSchema),
});

// The writable surface. baseline_date and planned_date are deliberately not
// here: re-baselining is governance, not an edit (ADR-0008).
export const MilestonePatchSchema = z
  .object({
    forecast_date: z.string().date().nullable().optional(),
    actual_date: z.string().date().nullable().optional(),
    status: z.enum(["not_started", "in_progress", "complete", "blocked", "na"]).optional(),
    blocker_note: z.string().max(2000).nullable().optional(),
    evidence_uri: z.string().url().nullable().optional(),
    owner_id: z.string().uuid().nullable().optional(),
  })
  .strict();

// Status + eTMF pointer only, never content or signatures (ADR-0006).
export const DeliverableSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  version: z.string().nullable(),
  status: z.enum(["draft", "in_review", "approved", "superseded"]),
  approved_date: z.string().nullable(),
  etmf_uri: z.string().nullable(),
  owner_id: z.string().nullable(),
  owner_name: z.string().nullable(),
  updated_at: z.string(),
});

export const StudyDeliverablesSchema = z.object({
  study_id: z.string().uuid(),
  deliverables: z.array(DeliverableSchema),
});

// The writable surface. type and title are identity, not status — a
// different deliverable is a new row (ADR-0006).
export const DeliverablePatchSchema = z
  .object({
    status: z.enum(["draft", "in_review", "approved", "superseded"]).optional(),
    approved_date: z.string().date().nullable().optional(),
    etmf_uri: z.string().url().nullable().optional(),
    owner_id: z.string().uuid().nullable().optional(),
    version: z.string().max(50).nullable().optional(),
  })
  .strict();

// Cycle status, mirrored counts, and an evidence pointer — the executed
// scripts live in the validated system and the eTMF (ADR-0010, ADR-0006).
export const UatCycleSchema = z.object({
  id: z.string().uuid(),
  cycle_number: z.number(),
  title: z.string(),
  status: z.enum(["planned", "in_progress", "complete", "cancelled"]),
  started_date: z.string().nullable(),
  completed_date: z.string().nullable(),
  scripts_planned: z.number().nullable(),
  scripts_executed: z.number().nullable(),
  evidence_uri: z.string().nullable(),
  updated_at: z.string(),
  open_defects: z.number(),
  resolved_defects: z.number(),
  closed_defects: z.number(),
  withdrawn_defects: z.number(),
  total_defects: z.number(),
});

export const StudyUatCyclesSchema = z.object({
  study_id: z.string().uuid(),
  cycles: z.array(UatCycleSchema),
});

export const UatCyclePostSchema = z
  .object({
    title: z.string().min(1).max(200),
    started_date: z.string().date().nullable().optional(),
    scripts_planned: z.number().int().positive().nullable().optional(),
  })
  .strict();

// The writable surface. title and study_id are identity — a different round
// of UAT is a new row (ADR-0010).
export const UatCyclePatchSchema = z
  .object({
    status: z.enum(["planned", "in_progress", "complete", "cancelled"]).optional(),
    started_date: z.string().date().nullable().optional(),
    completed_date: z.string().date().nullable().optional(),
    scripts_planned: z.number().int().positive().nullable().optional(),
    scripts_executed: z.number().int().nonnegative().nullable().optional(),
    evidence_uri: z.string().url().nullable().optional(),
  })
  .strict();

// resolution_note is optional because the sponsor serialization omits it
// entirely (DM-P5) — a curated view, not a blanked field.
export const UatDefectSchema = z.object({
  id: z.string().uuid(),
  defect_number: z.number(),
  title: z.string(),
  severity: z.enum(["critical", "major", "minor"]),
  status: z.enum(["open", "resolved", "closed", "withdrawn"]),
  raised_date: z.string(),
  resolved_date: z.string().nullable(),
  resolution_note: z.string().nullable().optional(),
  reference_uri: z.string().nullable(),
  updated_at: z.string(),
});

export const CycleDefectsSchema = z.object({
  study_id: z.string().uuid(),
  cycle_id: z.string().uuid(),
  defects: z.array(UatDefectSchema),
});

export const UatDefectPostSchema = z
  .object({
    title: z.string().min(1).max(500),
    severity: z.enum(["critical", "major", "minor"]),
    raised_date: z.string().date().nullable().optional(),
    reference_uri: z.string().url().nullable().optional(),
  })
  .strict();

// The writable surface. title is identity — a different finding is a new row
// (ADR-0010).
export const UatDefectPatchSchema = z
  .object({
    status: z.enum(["open", "resolved", "closed", "withdrawn"]).optional(),
    severity: z.enum(["critical", "major", "minor"]).optional(),
    resolved_date: z.string().date().nullable().optional(),
    resolution_note: z.string().max(2000).nullable().optional(),
    reference_uri: z.string().url().nullable().optional(),
  })
  .strict();

// The only path that can move planned_date (ADR-0009). baseline_date has no
// write path at all.
export const RebaselinePostSchema = z
  .object({
    planned_date: z.string().date(),
    reason: z.string().min(10).max(2000),
    reference_uri: z.string().url().nullable().optional(),
  })
  .strict();

// reason is optional because the sponsor serialization omits it entirely
// (DM-P5) — a curated view, not a blanked field.
export const RebaselineRecordSchema = z.object({
  rebaseline_number: z.number(),
  previous_planned_date: z.string().nullable(),
  new_planned_date: z.string(),
  reason: z.string().optional(),
  reference_uri: z.string().nullable(),
  created_at: z.string(),
});

export const RebaselineResultSchema = z.object({
  milestone: BoardRowSchema,
  rebaseline: RebaselineRecordSchema,
});

export const SnapshotSchema = z.object({
  metric_id: z.string(),
  metric_version: z.string(),
  grain: z.string(),
  site_id: z.string().nullable(),
  period_start: z.string(),
  period_end: z.string(),
  value: z.string().nullable(),
  numerator: z.string().nullable(),
  denominator: z.string().nullable(),
  n_records: z.number().nullable(),
  computed_at: z.string(),
});

export const MetricSiteRowSchema = SnapshotSchema.extend({
  site_number: z.string(),
  site_name: z.string().nullable(),
  country: z.string().nullable(),
});

export const MetricSitesSchema = z.object({
  study_id: z.string().uuid(),
  metric_id: z.string(),
  sites: z.array(MetricSiteRowSchema),
});

export const StudyMetricSchema = z.object({
  metric_id: z.string(),
  version: z.string(),
  label: z.string(),
  target: z.string().nullable(),
  availability: z.string(), // "computed" | "unavailable: <gap>" | "not yet computed"
  latest: SnapshotSchema.nullable(),
});

export const StudyMetricsSchema = z.object({
  study_id: z.string().uuid(),
  metrics: z.array(StudyMetricSchema),
});

export const HealthSchema = z.object({
  status: z.string(),
  migrations: z.number(),
  audit_chain_verified: z.boolean(),
});
