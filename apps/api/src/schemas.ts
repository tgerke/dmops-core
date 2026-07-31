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

// Roster mirrors (ADR-0013): display-only rows read from the mirrors, one
// serialization for every role — status and dates only, nothing to curate.
export const RosterRowSchema = z.object({
  person_key: z.string(),
  person_name: z.string().nullable(),
  roles: z.array(z.string()),
  site_keys: z.array(z.string()).nullable(),
  account_status: z.enum(["active", "locked", "deactivated"]),
  first_granted_at: z.string().nullable(),
  mirrored_at: z.string(),
  trainings_on_file: z.number(),
  trainings_current: z.number(),
  trainings_overdue: z.number(),
  trainings_expired: z.number(),
  trainings_pending: z.number(),
  training_gap: z.boolean(),
});

export const AccessRosterSchema = z.object({
  study_id: z.string().uuid(),
  people: z.array(RosterRowSchema),
});

export const TrainingStatusRowSchema = z.object({
  person_key: z.string(),
  person_name: z.string().nullable(),
  course_key: z.string(),
  course_title: z.string().nullable(),
  due_date: z.string().nullable(),
  completed_date: z.string().nullable(),
  expires_date: z.string().nullable(),
  mirrored_at: z.string(),
  status: z.enum(["current", "expired", "overdue", "pending"]),
});

export const StudyTrainingSchema = z.object({
  study_id: z.string().uuid(),
  records: z.array(TrainingStatusRowSchema),
});

// Lock-readiness (ADR-0014): a derived checklist — the depends_on closure of
// CLOSE.LOCK — plus live signals that never move the score. blocker_note is
// optional because the sponsor serialization omits it entirely (DM-P5).
export const LockGateSchema = z.object({
  code: z.string(),
  label: z.string(),
  phase_group: z.string(),
  sequence: z.number(),
  occurrence: z.number().nullable(),
  status: z.string().nullable(),
  baseline_date: z.string().nullable(),
  planned_date: z.string().nullable(),
  forecast_date: z.string().nullable(),
  actual_date: z.string().nullable(),
  blocker_note: z.string().nullable().optional(),
  evidence_uri: z.string().nullable(),
  satisfied: z.boolean(),
  applicable: z.boolean(),
});

export const EvidenceConflictSchema = z.object({
  gate: z.string(),
  signal: z.string(),
  detail: z.string(),
});

export const LockReadinessSchema = z.object({
  study_id: z.string().uuid(),
  gates_applicable: z.number(),
  gates_satisfied: z.number(),
  gates_blocked: z.number(),
  readiness_pct: z.number().nullable(),
  next_gate_code: z.string().nullable(),
  next_gate_label: z.string().nullable(),
  lock_planned_date: z.string().nullable(),
  lock_forecast_date: z.string().nullable(),
  lock_actual_date: z.string().nullable(),
  // Signals: null means the source is not wired, never zero (ADR-0005
  // fail-closed applied to display).
  open_queries: z.number().nullable(),
  open_queries_as_of: z.string().nullable(),
  uat_open_cycles: z.number().nullable(),
  uat_unresolved_defects: z.number().nullable(),
  training_gaps: z.number().nullable(),
  gates: z.array(LockGateSchema),
  evidence_conflicts: z.array(EvidenceConflictSchema),
});

// Portfolio roll-up (ADR-0015): every number derives from stored study-grain
// snapshots or the lock-readiness views. pooled is null when pooling is not
// honest — medians, mixed versions — and not_pooled_reason plus the
// per_study spread are served instead (ADR-0005 fail-closed on aggregation).
export const PortfolioStudyValueSchema = z.object({
  study_id: z.string().uuid(),
  protocol_number: z.string(),
  metric_version: z.string(),
  value: z.string().nullable(),
  n_records: z.number().nullable(),
  period_end: z.string(),
});

export const PortfolioMetricSchema = z.object({
  metric_id: z.string(),
  version: z.string(),
  label: z.string(),
  module: z.string(),
  target: z.string().nullable(),
  pooling: z.enum(["sum", "ratio", "median"]),
  studies_in_scope: z.number(),
  studies_reporting: z.number(),
  poolable: z.boolean(),
  not_pooled_reason: z.string().nullable(),
  pooled: z
    .object({
      numerator: z.number(),
      denominator: z.number(),
      pct: z.number().nullable(),
    })
    .nullable(),
  min_value: z.string().nullable(),
  max_value: z.string().nullable(),
  per_study: z.array(PortfolioStudyValueSchema),
  earliest_period_end: z.string().nullable(),
  latest_period_end: z.string().nullable(),
});

export const PortfolioLockStudySchema = z.object({
  study_id: z.string().uuid(),
  protocol_number: z.string(),
  readiness_pct: z.number().nullable(),
  gates_satisfied: z.number(),
  gates_applicable: z.number(),
  gates_blocked: z.number(),
  next_gate_code: z.string().nullable(),
  next_gate_label: z.string().nullable(),
  lock_planned_date: z.string().nullable(),
  lock_forecast_date: z.string().nullable(),
  lock_actual_date: z.string().nullable(),
});

export const PortfolioLockTrendPointSchema = z.object({
  period_start: z.string(),
  period_end: z.string(),
  studies_reporting: z.number(),
  gates_satisfied: z.number(),
  gates_applicable: z.number(),
  readiness_pct: z.number().nullable(),
});

export const PortfolioSchema = z.object({
  studies: z.object({
    total: z.number(),
    by_status: z.record(z.string(), z.number()),
    stat_enabled: z.number(),
  }),
  metrics: z.array(PortfolioMetricSchema),
  lock: z.object({
    studies: z.number(),
    gates_applicable: z.number(),
    gates_satisfied: z.number(),
    readiness_pct: z.number().nullable(),
    studies_with_blocked_gates: z.number(),
    studies_locked: z.number(),
    per_study: z.array(PortfolioLockStudySchema),
    trend: z.array(PortfolioLockTrendPointSchema),
  }),
});

// --- exports and KPI packs (ADR-0016) ---------------------------------------

export const PackSnapshotSchema = z.object({
  metric_version: z.string(),
  grain: z.string(),
  site_number: z.string().nullable(),
  period_start: z.string(),
  period_end: z.string(),
  value: z.string().nullable(),
  numerator: z.string().nullable(),
  denominator: z.string().nullable(),
  n_records: z.number().nullable(),
  computed_at: z.string(),
  source_extract_id: z.string().nullable(),
});

export const PackMetricSchema = z.object({
  metric_id: z.string(),
  version: z.string(),
  label: z.string(),
  module: z.string(),
  target: z.string().nullable(),
  definition: z.string(),
  absence: z.string().nullable(),
  snapshot: PackSnapshotSchema.nullable(),
  sites: z.array(PackSnapshotSchema),
});

export const KpiPackSchema = z.object({
  study: z.object({
    study_id: z.string().uuid(),
    protocol_number: z.string(),
    short_title: z.string().nullable(),
    phase: z.string().nullable(),
    indication: z.string().nullable(),
    status: z.string(),
    sponsor_name: z.string().nullable(),
    dm_lead_name: z.string().nullable(),
    modules: z.array(z.string()),
    calendar: z.object({ id: z.string(), label: z.string().nullable() }).nullable(),
  }),
  period: z.object({ start: z.string(), end: z.string() }),
  available_periods: z.array(z.string()),
  generated_at: z.string(),
  generated_by: z.string(),
  metrics: z.array(PackMetricSchema),
  provenance: z.object({
    extracts: z.array(
      z.object({
        id: z.string().uuid(),
        adapter: z.string(),
        extracted_at: z.string(),
        checksum: z.string(),
        row_counts: z.record(z.string(), z.number()).nullable(),
      }),
    ),
  }),
});

export const HealthSchema = z.object({
  status: z.string(),
  migrations: z.number(),
  audit_chain_verified: z.boolean(),
});
