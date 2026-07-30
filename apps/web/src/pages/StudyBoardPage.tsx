import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { type ApiError, type BoardRow, type StudyMetric, api } from "../api";
import { currentPersona } from "../auth";
import { ErrorNote, SlipBadge, Spinner, StatusChip } from "../components";

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
  }, [studyId]);
  useEffect(() => {
    load();
  }, [load]);

  if (error) return <ErrorNote message={error} />;
  if (!rows || !studyId) return <Spinner label="Loading milestone board…" />;

  return (
    <div className="space-y-6">
      {metrics && <MetricsStrip metrics={metrics} />}
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

function MetricsStrip({ metrics }: { metrics: StudyMetric[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics.map((m) => (
        <div key={m.metric_id} className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">{m.label}</p>
          {m.availability === "computed" && m.latest ? (
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
        </div>
      ))}
    </div>
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
      <td className="px-4 py-3 text-slate-600">{row.planned_date ?? "—"}</td>
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
