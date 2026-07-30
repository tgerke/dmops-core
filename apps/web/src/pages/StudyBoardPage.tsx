import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  type ApiError,
  type BoardRow,
  type Deliverable,
  type MetricSiteRow,
  type Snapshot,
  type StudyMetric,
  type UatCycle,
  type UatDefect,
  api,
} from "../api";
import { currentPersona } from "../auth";
import {
  DefectChip,
  DeliverableChip,
  ErrorNote,
  SeverityBadge,
  SlipBadge,
  Sparkline,
  Spinner,
  StatusChip,
  UatCycleChip,
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
  const [uatCycles, setUatCycles] = useState<UatCycle[] | null>(null);
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
    api
      .uatCycles(studyId)
      .then((u) => setUatCycles(u.cycles))
      .catch(() => setUatCycles(null));
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
      {uatCycles && (uatCycles.length > 0 || currentPersona().canWriteUat) && (
        <UatSection studyId={studyId} cycles={uatCycles} onSaved={load} />
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

function UatSection({
  studyId,
  cycles,
  onSaved,
}: {
  studyId: string;
  cycles: UatCycle[];
  onSaved: () => void;
}) {
  const canWrite = currentPersona().canWriteUat;
  const [newTitle, setNewTitle] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const createCycle = async () => {
    if (!newTitle.trim()) return;
    try {
      setCreateError(null);
      await api.createUatCycle(studyId, { title: newTitle.trim() });
      setNewTitle("");
      onSaved();
    } catch (e) {
      setCreateError((e as ApiError).message);
    }
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">UAT</h2>
      <div className="space-y-3">
        {cycles.map((c) => (
          <UatCycleCard key={c.id} studyId={studyId} cycle={c} onSaved={onSaved} />
        ))}
        {canWrite && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newTitle}
                placeholder="New UAT cycle title (e.g. Amendment 4 regression UAT)"
                className="w-96 rounded border border-slate-300 px-2 py-1 text-xs"
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createCycle()}
              />
              <button
                type="button"
                className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
                onClick={createCycle}
              >
                start cycle
              </button>
            </div>
            {createError && <p className="mt-1 text-xs text-rose-600">{createError}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function UatCycleCard({
  studyId,
  cycle,
  onSaved,
}: {
  studyId: string;
  cycle: UatCycle;
  onSaved: () => void;
}) {
  const canWrite = currentPersona().canWriteUat;
  const [expanded, setExpanded] = useState(false);
  const [defects, setDefects] = useState<UatDefect[] | null>(null);
  const [pendingComplete, setPendingComplete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // UAT complete means defects resolved (ADR-0010); the server enforces this too.
  const completeBlocked = cycle.open_defects + cycle.resolved_defects > 0;

  const loadDefects = useCallback(() => {
    api
      .uatDefects(studyId, cycle.id)
      .then((d) => setDefects(d.defects))
      .catch(() => setDefects(null));
  }, [studyId, cycle.id]);
  useEffect(() => {
    if (expanded) loadDefects();
  }, [expanded, loadDefects]);

  const save = async (patch: Record<string, unknown>) => {
    try {
      setSaveError(null);
      await api.patchUatCycle(studyId, cycle.id, patch);
      setPendingComplete(false);
      onSaved();
    } catch (e) {
      setSaveError((e as ApiError).message);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-slate-600"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "▾" : "▸"}
        </button>
        <span className="font-medium">{cycle.title}</span>
        <span className="font-mono text-xs text-slate-400">#{cycle.cycle_number}</span>
        <UatCycleChip status={cycle.status} />
        <span className="text-xs text-slate-500">
          {cycle.open_defects > 0 && (
            <span className="mr-2 font-medium text-rose-600">{cycle.open_defects} open</span>
          )}
          {cycle.resolved_defects > 0 && (
            <span className="mr-2 font-medium text-amber-600">
              {cycle.resolved_defects} awaiting retest
            </span>
          )}
          {cycle.closed_defects} closed / {cycle.total_defects} defects
        </span>
        {cycle.scripts_planned !== null && (
          <span className="text-xs text-slate-500">
            scripts {cycle.scripts_executed ?? 0}/{cycle.scripts_planned}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {cycle.evidence_uri && (
            <a
              href={cycle.evidence_uri}
              target="_blank"
              rel="noreferrer"
              title="Executed scripts live in the eTMF; dmops-core links, never holds (ADR-0006)"
              className="text-xs text-sky-600 hover:underline"
            >
              eTMF ↗
            </a>
          )}
          {canWrite &&
            cycle.status !== "complete" &&
            cycle.status !== "cancelled" &&
            (pendingComplete ? (
              <input
                type="date"
                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                title="The completion date on the validation record"
                onBlur={(e) =>
                  e.target.value && save({ status: "complete", completed_date: e.target.value })
                }
              />
            ) : (
              <button
                type="button"
                disabled={completeBlocked}
                title={
                  completeBlocked
                    ? "UAT complete means defects resolved (ADR-0010): close or withdraw the remaining defects first"
                    : "Mark this cycle complete"
                }
                className={`rounded px-2 py-1 text-xs ${
                  completeBlocked
                    ? "cursor-not-allowed bg-slate-50 text-slate-300"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                }`}
                onClick={() => setPendingComplete(true)}
              >
                complete
              </button>
            ))}
        </span>
      </div>
      {saveError && <p className="px-4 pb-2 text-xs text-rose-600">{saveError}</p>}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3">
          {defects === null ? (
            <Spinner label="Loading defects…" />
          ) : (
            <UatDefectTable
              studyId={studyId}
              cycle={cycle}
              defects={defects}
              onSaved={() => {
                loadDefects();
                onSaved();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function UatDefectTable({
  studyId,
  cycle,
  defects,
  onSaved,
}: {
  studyId: string;
  cycle: UatCycle;
  defects: UatDefect[];
  onSaved: () => void;
}) {
  const canWrite = currentPersona().canWriteUat;
  const cycleActive = cycle.status !== "complete" && cycle.status !== "cancelled";
  const [newTitle, setNewTitle] = useState("");
  const [newSeverity, setNewSeverity] = useState("major");
  const [createError, setCreateError] = useState<string | null>(null);

  const logDefect = async () => {
    if (!newTitle.trim()) return;
    try {
      setCreateError(null);
      await api.createUatDefect(studyId, cycle.id, {
        title: newTitle.trim(),
        severity: newSeverity,
      });
      setNewTitle("");
      onSaved();
    } catch (e) {
      setCreateError((e as ApiError).message);
    }
  };

  return (
    <div>
      {defects.length === 0 ? (
        <p className="text-xs text-slate-400">No defects logged on this cycle.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="py-1 pr-4">Defect</th>
              <th className="py-1 pr-4">Severity</th>
              <th className="py-1 pr-4">Raised</th>
              <th className="py-1 pr-4">Resolved</th>
              <th className="py-1 pr-4">Status</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {defects.map((d) => (
              <UatDefectRow
                key={d.id}
                studyId={studyId}
                cycleId={cycle.id}
                defect={d}
                onSaved={onSaved}
              />
            ))}
          </tbody>
        </table>
      )}
      {canWrite && cycleActive && (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={newTitle}
            placeholder="Log a defect…"
            className="w-96 rounded border border-slate-300 px-2 py-1 text-xs"
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && logDefect()}
          />
          <select
            value={newSeverity}
            className="rounded border border-slate-300 px-1 py-1 text-xs"
            onChange={(e) => setNewSeverity(e.target.value)}
          >
            {["critical", "major", "minor"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
            onClick={logDefect}
          >
            log defect
          </button>
        </div>
      )}
      {createError && <p className="mt-1 text-xs text-rose-600">{createError}</p>}
    </div>
  );
}

function UatDefectRow({
  studyId,
  cycleId,
  defect,
  onSaved,
}: {
  studyId: string;
  cycleId: string;
  defect: UatDefect;
  onSaved: () => void;
}) {
  const canWrite = currentPersona().canWriteUat;
  const [editing, setEditing] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [note, setNote] = useState(defect.resolution_note ?? "");
  const [date, setDate] = useState(defect.resolved_date ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async (patch: Record<string, unknown>) => {
    try {
      setSaveError(null);
      await api.patchUatDefect(studyId, cycleId, defect.id, patch);
      setEditing(false);
      setPendingStatus(null);
      onSaved();
    } catch (e) {
      setSaveError((e as ApiError).message);
    }
  };

  // Endings are dated facts and closure carries a note (ADR-0010); collect
  // what the server will require before submitting.
  const submitStatus = (status: string) => {
    if (status === "open") {
      save({ status, resolved_date: null });
    } else if (status === "resolved") {
      setPendingStatus(status);
    } else {
      setPendingStatus(status);
    }
  };

  const needsNote = pendingStatus === "closed" || pendingStatus === "withdrawn";
  const needsDate = pendingStatus === "resolved" || pendingStatus === "closed";

  return (
    <tr className="border-b border-slate-100 align-top last:border-0">
      <td className="py-1.5 pr-4">
        <span className="font-mono text-xs text-slate-400">#{defect.defect_number}</span>
        <span className="ml-2">{defect.title}</span>
        {defect.resolution_note && (
          <p className="mt-0.5 max-w-md text-xs text-slate-400">{defect.resolution_note}</p>
        )}
        {saveError && <p className="mt-0.5 text-xs text-rose-600">{saveError}</p>}
        {pendingStatus && (
          <span className="mt-1 flex items-center gap-2">
            {needsDate && (
              <input
                type="date"
                value={date}
                className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                onChange={(e) => setDate(e.target.value)}
              />
            )}
            {needsNote && (
              <input
                type="text"
                value={note}
                placeholder="Resolution note (required)"
                className="w-64 rounded border border-slate-300 px-1 py-0.5 text-xs"
                onChange={(e) => setNote(e.target.value)}
              />
            )}
            <button
              type="button"
              className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
              onClick={() =>
                save({
                  status: pendingStatus,
                  ...(needsDate ? { resolved_date: date || null } : {}),
                  ...(needsNote ? { resolution_note: note || null } : {}),
                })
              }
            >
              save
            </button>
          </span>
        )}
      </td>
      <td className="py-1.5 pr-4">
        <SeverityBadge severity={defect.severity} />
      </td>
      <td className="py-1.5 pr-4 text-slate-500">{defect.raised_date}</td>
      <td className="py-1.5 pr-4 text-slate-500">{defect.resolved_date ?? "—"}</td>
      <td className="py-1.5 pr-4">
        {editing ? (
          <select
            defaultValue={defect.status}
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
            onChange={(e) => submitStatus(e.target.value)}
          >
            {["open", "resolved", "closed", "withdrawn"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <DefectChip status={defect.status} />
        )}
      </td>
      <td className="py-1.5 text-right">
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
