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
