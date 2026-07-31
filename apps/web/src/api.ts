import { currentPersona } from "./auth";

export interface StudySummary {
  study_id: string;
  protocol_number: string;
  short_title: string | null;
  phase: string | null;
  indication: string | null;
  study_status: string;
  sponsor_name: string | null;
  dm_lead_name: string | null;
  milestone_total: number;
  milestone_complete: number;
  milestone_blocked: number;
  milestone_in_progress: number;
  milestone_na: number;
  pct_complete: number | null;
  next_milestone_code: string | null;
  next_milestone_label: string | null;
  next_milestone_planned: string | null;
}

export interface BoardRow {
  id: string;
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
  owner_name: string | null;
  blocker_note?: string | null;
  evidence_uri: string | null;
  forecast_slip_days: number | null;
  actual_slip_days: number | null;
  rebaseline_count: number;
  last_rebaselined_at: string | null;
}

export interface Deliverable {
  id: string;
  type: string;
  title: string;
  version: string | null;
  status: string;
  approved_date: string | null;
  etmf_uri: string | null;
  owner_name: string | null;
}

export interface UatCycle {
  id: string;
  cycle_number: number;
  title: string;
  status: string;
  started_date: string | null;
  completed_date: string | null;
  scripts_planned: number | null;
  scripts_executed: number | null;
  evidence_uri: string | null;
  open_defects: number;
  resolved_defects: number;
  closed_defects: number;
  withdrawn_defects: number;
  total_defects: number;
}

export interface UatDefect {
  id: string;
  defect_number: number;
  title: string;
  severity: string;
  status: string;
  raised_date: string;
  resolved_date: string | null;
  // Absent in the sponsor serialization (DM-P5).
  resolution_note?: string | null;
  reference_uri: string | null;
}

// Roster mirrors (ADR-0013): display-only, same serialization for every role.
export interface RosterRow {
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

export interface TrainingRecord {
  person_key: string;
  person_name: string | null;
  course_key: string;
  course_title: string | null;
  due_date: string | null;
  completed_date: string | null;
  expires_date: string | null;
  mirrored_at: string;
  status: "current" | "expired" | "overdue" | "pending";
}

// Lock-readiness (ADR-0014): a derived checklist — nothing here is writable.
export interface LockGate {
  code: string;
  label: string;
  phase_group: string;
  sequence: number;
  occurrence: number | null;
  status: string | null;
  baseline_date: string | null;
  planned_date: string | null;
  forecast_date: string | null;
  actual_date: string | null;
  // Absent in the sponsor serialization (DM-P5).
  blocker_note?: string | null;
  evidence_uri: string | null;
  satisfied: boolean;
  applicable: boolean;
}

export interface EvidenceConflict {
  gate: string;
  signal: string;
  detail: string;
}

export interface LockReadiness {
  study_id: string;
  gates_applicable: number;
  gates_satisfied: number;
  gates_blocked: number;
  readiness_pct: number | null;
  next_gate_code: string | null;
  next_gate_label: string | null;
  lock_planned_date: string | null;
  lock_forecast_date: string | null;
  lock_actual_date: string | null;
  open_queries: number | null;
  open_queries_as_of: string | null;
  uat_open_cycles: number | null;
  uat_unresolved_defects: number | null;
  training_gaps: number | null;
  gates: LockGate[];
  evidence_conflicts: EvidenceConflict[];
}

export interface Snapshot {
  metric_id: string;
  metric_version: string;
  grain: string;
  site_id: string | null;
  period_start: string;
  period_end: string;
  value: string | null;
  n_records: number | null;
  computed_at: string;
}

export interface MetricSiteRow extends Snapshot {
  site_number: string;
  site_name: string | null;
  country: string | null;
}

export interface StudyMetric {
  metric_id: string;
  version: string;
  label: string;
  target: string | null;
  availability: string;
  latest: {
    value: string | null;
    n_records: number | null;
    period_start: string;
    period_end: string;
  } | null;
}

// Portfolio roll-up (ADR-0015): derived from stored study snapshots. pooled
// is null when pooling is not honest (medians, mixed versions) — render
// not_pooled_reason and the per_study spread instead.
export interface PortfolioStudyValue {
  study_id: string;
  protocol_number: string;
  metric_version: string;
  value: string | null;
  n_records: number | null;
  period_end: string;
}

export interface PortfolioMetric {
  metric_id: string;
  version: string;
  label: string;
  module: string;
  target: string | null;
  pooling: "sum" | "ratio" | "median";
  studies_in_scope: number;
  studies_reporting: number;
  poolable: boolean;
  not_pooled_reason: string | null;
  pooled: { numerator: number; denominator: number; pct: number | null } | null;
  min_value: string | null;
  max_value: string | null;
  per_study: PortfolioStudyValue[];
  earliest_period_end: string | null;
  latest_period_end: string | null;
}

export interface PortfolioLockStudy {
  study_id: string;
  protocol_number: string;
  readiness_pct: number | null;
  gates_satisfied: number;
  gates_applicable: number;
  gates_blocked: number;
  next_gate_code: string | null;
  next_gate_label: string | null;
  lock_planned_date: string | null;
  lock_forecast_date: string | null;
  lock_actual_date: string | null;
}

export interface PortfolioLockTrendPoint {
  period_start: string;
  period_end: string;
  studies_reporting: number;
  gates_satisfied: number;
  gates_applicable: number;
  readiness_pct: number | null;
}

export interface Portfolio {
  studies: {
    total: number;
    by_status: Record<string, number>;
    stat_enabled: number;
  };
  metrics: PortfolioMetric[];
  lock: {
    studies: number;
    gates_applicable: number;
    gates_satisfied: number;
    readiness_pct: number | null;
    studies_with_blocked_gates: number;
    studies_locked: number;
    per_study: PortfolioLockStudy[];
    trend: PortfolioLockTrendPoint[];
  };
}

// KPI pack (ADR-0016): one period's snapshots for one study, each metric
// with its registered definition at the computed version, plus the cited
// source extracts. Assembled from stored facts; nothing computed or stored.
export interface PackSnapshot {
  metric_version: string;
  grain: string;
  site_number: string | null;
  period_start: string;
  period_end: string;
  value: string | null;
  numerator: string | null;
  denominator: string | null;
  n_records: number | null;
  computed_at: string;
  source_extract_id: string | null;
}

export interface PackMetric {
  metric_id: string;
  version: string;
  label: string;
  module: string;
  target: string | null;
  definition: string;
  absence: string | null;
  snapshot: PackSnapshot | null;
  sites: PackSnapshot[];
}

export interface KpiPack {
  study: {
    study_id: string;
    protocol_number: string;
    short_title: string | null;
    phase: string | null;
    indication: string | null;
    status: string;
    sponsor_name: string | null;
    dm_lead_name: string | null;
    modules: string[];
    calendar: { id: string; label: string | null } | null;
  };
  period: { start: string; end: string };
  available_periods: string[];
  generated_at: string;
  generated_by: string;
  metrics: PackMetric[];
  provenance: {
    extracts: {
      id: string;
      adapter: string;
      extracted_at: string;
      checksum: string;
      row_counts: Record<string, number> | null;
    }[];
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${currentPersona().token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch a CSV export with the persona's bearer token and hand it to the
 * browser as a download — a plain <a href> cannot carry the header.
 */
export async function downloadCsv(path: string): Promise<void> {
  const res = await fetch(`/api${path}`, {
    headers: { authorization: `Bearer ${currentPersona().token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `${res.status} ${res.statusText}`);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "export.csv";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const api = {
  studies: () => request<StudySummary[]>("/studies"),
  portfolio: () => request<Portfolio>("/portfolio"),
  kpiPack: (studyId: string, period?: string) =>
    request<KpiPack>(`/studies/${studyId}/kpi-pack${period ? `?period=${period}` : ""}`),
  milestones: (studyId: string) =>
    request<{ milestones: BoardRow[] }>(`/studies/${studyId}/milestones`),
  metrics: (studyId: string) => request<{ metrics: StudyMetric[] }>(`/studies/${studyId}/metrics`),
  patchMilestone: (
    studyId: string,
    code: string,
    occurrence: number,
    patch: Record<string, unknown>,
  ) =>
    request<BoardRow>(
      `/studies/${studyId}/milestones/${encodeURIComponent(code)}?occurrence=${occurrence}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  deliverables: (studyId: string) =>
    request<{ deliverables: Deliverable[] }>(`/studies/${studyId}/deliverables`),
  patchDeliverable: (studyId: string, deliverableId: string, patch: Record<string, unknown>) =>
    request<Deliverable>(`/studies/${studyId}/deliverables/${deliverableId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  uatCycles: (studyId: string) => request<{ cycles: UatCycle[] }>(`/studies/${studyId}/uat-cycles`),
  createUatCycle: (studyId: string, body: Record<string, unknown>) =>
    request<UatCycle>(`/studies/${studyId}/uat-cycles`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchUatCycle: (studyId: string, cycleId: string, patch: Record<string, unknown>) =>
    request<UatCycle>(`/studies/${studyId}/uat-cycles/${cycleId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  uatDefects: (studyId: string, cycleId: string) =>
    request<{ defects: UatDefect[] }>(`/studies/${studyId}/uat-cycles/${cycleId}/defects`),
  createUatDefect: (studyId: string, cycleId: string, body: Record<string, unknown>) =>
    request<UatDefect>(`/studies/${studyId}/uat-cycles/${cycleId}/defects`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchUatDefect: (
    studyId: string,
    cycleId: string,
    defectId: string,
    patch: Record<string, unknown>,
  ) =>
    request<UatDefect>(`/studies/${studyId}/uat-cycles/${cycleId}/defects/${defectId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  lockReadiness: (studyId: string) => request<LockReadiness>(`/studies/${studyId}/lock-readiness`),
  accessRoster: (studyId: string) =>
    request<{ people: RosterRow[] }>(`/studies/${studyId}/access-roster`),
  training: (studyId: string) =>
    request<{ records: TrainingRecord[] }>(`/studies/${studyId}/training`),
  snapshots: (studyId: string, metricId: string, grain: string) =>
    request<Snapshot[]>(`/studies/${studyId}/metrics/${metricId}/snapshots?grain=${grain}`),
  metricSites: (studyId: string, metricId: string) =>
    request<{ sites: MetricSiteRow[] }>(`/studies/${studyId}/metrics/${metricId}/sites`),
};
