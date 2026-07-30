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

export const api = {
  studies: () => request<StudySummary[]>("/studies"),
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
};
