import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  type ApiError,
  type BoardRow,
  type Deliverable,
  type MetricSiteRow,
  type Snapshot,
  type StudyMetric,
  api,
} from "../api";
import { currentPersona } from "../auth";
import {
  DeliverableChip,
  ErrorNote,
  SlipBadge,
  Sparkline,
  Spinner,
  StatusChip,
} from "../components";

const phaseGroups: [string, string][] = [
  ["startup_spec", "Startup — Specification"],
  ["startup_build", "Startup — Build"],
  ["startup_release", "Startup — Validation & Release"],
  ["conduct", "Conduct"],
  ["closeout", "Closeout"],
];

export function StudyBoardPage() {
  const { studyId } = useParams<{ studyId: string }>();
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [metrics, setMetrics] = useState<StudyMetric[] | null>(null);
  const [deliverables, setDeliverables] = useState<Deliverable[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!studyId) return;
    api
      .milestones(studyId)
      .then((b) => setRows(b.milestones))
      .catch((e: ApiError) => setError(e.message));
    api
      .metrics(studyId)
      .then((m) => setMetrics(m.metrics))
      .catch(() => setMetrics(null));
    api
      .deliverables(studyId)
      .then((d) => setDeliverables(d.deliverables))
      .catch(() => setDeliverables(null));
  }, [studyId]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!rows || !studyId) return <Spinner label="Loading milestone board…" />;

  return (
    <div className="space-y-6">
      {metrics && <MetricsStrip studyId={studyId} metrics={metrics} />}
      {deliverables && deliverables.length > 0 && (
        <DeliverablesSection studyId={studyId} deliverables={deliverables} onSaved={load} />
      )}
      {phaseGroups.map(([group, title]) => {
        const groupRows = rows.filter((r) => r.phase_group === group);
        if (groupRows.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {title}
            </h2>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2">Milestone</th>
                    <th className="px-4 py-2">Owner</th>
                    <th className="px-4 py-2">Planned</th>
                    <th className="px-4 py-2">Forecast</th>
                    <th className="px-4 py-2">Actual</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {groupRows.map((row) => (
                    <MilestoneRow key={row.id} studyId={studyId} row={row} onSaved={load} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MetricsStrip({ studyId, metrics }: { studyId: string; metrics: StudyMetric[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => {
          const computed = m.availability === "computed" && m.latest;
          return (
            <button
              key={m.metric_id}
              type="button"
              disabled={!computed}
              onClick={() => setExpanded(expanded === m.metric_id ? null : m.metric_id)}
              className={`rounded-lg border bg-white p-3 text-left ${
                expanded === m.metric_id ? "border-sky-400" : "border-slate-200"
              } ${computed ? "cursor-pointer hover:border-sky-300" : "cursor-default"}`}
            >
              <p className="text-xs text-slate-500">{m.label}</p>
              {computed && m.latest ? (
                <>
                  <p className="mt-1 text-2xl font-semibold">
                    {m.latest.value === null ? "—" : Number(m.latest.value)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {m.latest.period_start} → {m.latest.period_end}
                    {m.target && ` · target ${m.target}`}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs leading-5 text-amber-700">
                  {m.availability}
                  <span className="mt-0.5 block text-slate-400">
                    Skipped, not approximated (ADR-0005)
                  </span>
                </p>
              )}
            </button>
          );
        })}
      </div>
      {expanded && <MetricDetail key={expanded} studyId={studyId} metricId={expanded} />}
    </div>
  );
}

function MetricDetail({ studyId, metricId }: { studyId: string; metricId: string }) {
  const [history, setHistory] = useState<Snapshot[] | null>(null);
  const [sites, setSites] = useState<MetricSiteRow[] | null>(null);

  useEffect(() => {
    api.snapshots(studyId, metricId, "study").then(setHistory);
    api.metricSites(studyId, metricId).then((r) => setSites(r.sites));
  }, [studyId, metricId]);

  if (!history || !sites) return <Spinner label="Loading metric detail…" />;

  // Latest computation per period (v_metric_latest semantics, applied to
  // history), oldest period first for the trend.
  const byPeriod = new Map<string, Snapshot>();
  for (const s of history) {
    const existing = byPeriod.get(s.period_start);
    if (!existing || s.computed_at > existing.computed_at) byPeriod.set(s.period_start, s);
  }
  const trend = [...byPeriod.values()]
    .sort((a, b) => a.period_start.localeCompare(b.period_start))
    .map((s) => ({ x: s.period_start, y: s.value === null ? null : Number(s.value) }));

  return (
    <div className="mt-3 grid gap-4 rounded-lg border border-slate-200 bg-white p-4 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Trend by reporting period
        </h3>
        <Sparkline points={trend} />
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          By site (latest period)
        </h3>
        {sites.length === 0 ? (
          <p className="text-xs text-slate-400">This metric is computed at study grain only.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-4">Site</th>
                <th className="py-1 pr-4">Country</th>
                <th className="py-1 pr-4 text-right">Value</th>
                <th className="py-1 text-right">n</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.site_number} className="border-b border-slate-100 last:border-0">
                  <td className="py-1.5 pr-4">
                    <span className="font-medium">{s.site_number}</span>
                    {s.site_name && <span className="ml-2 text-slate-500">{s.site_name}</span>}
                  </td>
                  <td className="py-1.5 pr-4 text-slate-500">{s.country ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right font-medium">
                    {s.value === null ? "—" : Number(s.value)}
                  </td>
                  <td className="py-1.5 text-right text-slate-500">{s.n_records ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function DeliverablesSection({
  studyId,
  deliverables,
  onSaved,
}: {
  studyId: string;
  deliverables: Deliverable[];
  onSaved: () => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Deliverables
      </h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2">Deliverable</th>
              <th className="px-4 py-2">Version</th>
              <th className="px-4 py-2">Owner</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Approved</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {deliverables.map((d) => (
              <DeliverableRow key={d.id} studyId={studyId} row={d} onSaved={onSaved} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DeliverableRow({
  studyId,
  row,
  onSaved,
}: {
  studyId: string;
  row: Deliverable;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canWrite = currentPersona().canWriteMilestones;

  const save = async (patch: Record<string, unknown>) => {
    try {
      setSaveError(null);
      await api.patchDeliverable(studyId, row.id, patch);
      setEditing(false);
      setPendingStatus(null);
      onSaved();
    } catch (e) {
      setSaveError((e as ApiError).message);
    }
  };

  return (
    <tr className="border-b border-slate-100 align-top last:border-0">
      <td className="px-4 py-3">
        <span className="font-medium">{row.title}</span>
        <span className="ml-2 font-mono text-xs text-slate-400">{row.type}</span>
        {saveError && <p className="mt-1 text-xs text-rose-600">{saveError}</p>}
      </td>
      <td className="px-4 py-3 text-slate-600">{row.version ?? "—"}</td>
      <td className="px-4 py-3 text-slate-500">{row.owner_name ?? "—"}</td>
      <td className="px-4 py-3">
        {editing ? (
          <select
            defaultValue={row.status}
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
            onChange={(e) => {
              // moving to approved needs a date (ADR-0006); collect it first
              if (e.target.value === "approved" && !row.approved_date) {
                setPendingStatus(e.target.value);
              } else {
                save({ status: e.target.value });
              }
            }}
          >
            {["draft", "in_review", "approved", "superseded"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <DeliverableChip status={row.status} />
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">
        {pendingStatus === "approved" ? (
          <input
            type="date"
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
            title="The approval date on the eTMF record (ADR-0006)"
            onBlur={(e) =>
              e.target.value && save({ status: "approved", approved_date: e.target.value })
            }
          />
        ) : (
          (row.approved_date ?? "—")
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {row.etmf_uri && (
          <a
            href={row.etmf_uri}
            target="_blank"
            rel="noreferrer"
            title="The record lives in the eTMF; dmops-core links, never holds (ADR-0006)"
            className="mr-2 text-xs text-sky-600 hover:underline"
          >
            eTMF ↗
          </a>
        )}
        {canWrite && (
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-600"
            onClick={() => {
              setEditing(!editing);
              setPendingStatus(null);
            }}
          >
            {editing ? "done" : "edit"}
          </button>
        )}
      </td>
    </tr>
  );
}

function MilestoneRow({
  studyId,
  row,
  onSaved,
}: {
  studyId: string;
  row: BoardRow;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const canWrite = currentPersona().canWriteMilestones;

  const save = async (patch: Record<string, unknown>) => {
    try {
      setSaveError(null);
      await api.patchMilestone(studyId, row.code, row.occurrence, patch);
      setEditing(false);
      onSaved();
    } catch (e) {
      setSaveError((e as ApiError).message);
    }
  };

  return (
    <tr className="border-b border-slate-100 align-top last:border-0">
      <td className="px-4 py-3">
        <span className="font-medium">{row.label}</span>
        {row.is_repeating && <span className="ml-1 text-xs text-slate-400">#{row.occurrence}</span>}
        <span className="ml-2 font-mono text-xs text-slate-400">{row.code}</span>
        {row.blocker_note && (
          <p className="mt-1 max-w-md rounded bg-rose-50 px-2 py-1 text-xs text-rose-700">
            {row.blocker_note}
          </p>
        )}
        {saveError && <p className="mt-1 text-xs text-rose-600">{saveError}</p>}
      </td>
      <td className="px-4 py-3 text-slate-500">{row.owner_name}</td>
      <td className="px-4 py-3 text-slate-600">
        {row.planned_date ?? "—"}
        {row.rebaseline_count > 0 && (
          <span
            className="ml-2 rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-600"
            title={`Re-baselined ${row.rebaseline_count}× (governed action, ADR-0009)${
              row.last_rebaselined_at ? ` — last ${row.last_rebaselined_at.slice(0, 10)}` : ""
            }`}
          >
            ⟲{row.rebaseline_count}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">
        {editing ? (
          <input
            type="date"
            defaultValue={row.forecast_date ?? ""}
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
            onBlur={(e) => e.target.value && save({ forecast_date: e.target.value })}
          />
        ) : (
          <>
            {row.forecast_date ?? "—"}
            <SlipBadge days={row.forecast_slip_days} />
          </>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600">
        {row.actual_date ?? "—"}
        {row.actual_date && <SlipBadge days={row.actual_slip_days} />}
      </td>
      <td className="px-4 py-3">
        {editing ? (
          <select
            defaultValue={row.status}
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
            onChange={(e) => save({ status: e.target.value })}
          >
            {["not_started", "in_progress", "complete", "blocked", "na"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <StatusChip status={row.status} />
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {row.evidence_uri && (
          <a
            href={row.evidence_uri}
            target="_blank"
            rel="noreferrer"
            title="Evidence lives in the eTMF; dmops-core links, never holds (ADR-0006)"
            className="mr-2 text-xs text-sky-600 hover:underline"
          >
            eTMF ↗
          </a>
        )}
        {canWrite && (
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-600"
            onClick={() => setEditing(!editing)}
          >
            {editing ? "done" : "edit"}
          </button>
        )}
      </td>
    </tr>
  );
}
