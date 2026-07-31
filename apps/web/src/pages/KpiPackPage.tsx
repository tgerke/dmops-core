import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { type ApiError, type KpiPack, api, downloadCsv } from "../api";
import { ErrorNote, Spinner } from "../components";

/**
 * The KPI pack, print-friendly (ADR-0016). Everything on this page is the
 * pack JSON rendered: the period's snapshots, each metric's registered
 * definition at the computed version, and the extract citations. Printing
 * to PDF is the browser's job — no server-side document generation.
 */
export function KpiPackPage() {
  const { studyId } = useParams<{ studyId: string }>();
  const [params, setParams] = useSearchParams();
  const period = params.get("period") ?? undefined;
  const [pack, setPack] = useState<KpiPack | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!studyId) return;
    setPack(null);
    setError(null);
    api
      .kpiPack(studyId, period)
      .then(setPack)
      .catch((e: ApiError) => setError(e));
  }, [studyId, period]);

  if (error) {
    return error.status === 404 ? (
      <ErrorNote message="No snapshots for this study or period yet — the pack has nothing to serve." />
    ) : (
      <ErrorNote message={error.message} />
    );
  }
  if (!pack || !studyId) return <Spinner label="Assembling KPI pack…" />;

  const study = pack.study;
  return (
    <div className="space-y-6 bg-white p-6 print:p-0 rounded-lg border border-slate-200 print:border-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">KPI pack</p>
          <h1 className="text-xl font-semibold">
            {study.protocol_number}
            {study.short_title && (
              <span className="ml-2 font-normal text-slate-500">{study.short_title}</span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Reporting period {pack.period.start} → {pack.period.end}
            {study.calendar && (
              <span className="ml-2 text-xs text-slate-400">
                calendar: {study.calendar.label ?? study.calendar.id}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <select
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={pack.period.start.slice(0, 7)}
            onChange={(e) => setParams({ period: e.target.value })}
          >
            {pack.available_periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => downloadCsv(`/studies/${studyId}/snapshots.csv`).catch(() => {})}
            className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-sky-300 hover:text-slate-900"
          >
            Snapshots CSV
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded bg-sky-600 px-3 py-1 text-sm text-white hover:bg-sky-700"
          >
            Print
          </button>
          <Link to={`/studies/${studyId}`} className="text-sm text-sky-700 hover:underline">
            Board
          </Link>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {(
          [
            ["Sponsor", study.sponsor_name],
            ["Phase", study.phase],
            ["Indication", study.indication],
            ["DM lead", study.dm_lead_name],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className="text-slate-700">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <section className="space-y-4">
        {pack.metrics.map((m) => (
          <div
            key={m.metric_id}
            className="rounded border border-slate-200 p-4 print:break-inside-avoid"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-sm font-semibold">
                {m.label}
                <span className="ml-2 font-mono text-xs font-normal text-slate-400">
                  {m.metric_id} v{m.version}
                </span>
              </h2>
              {m.snapshot ? (
                <p className="text-2xl font-semibold">
                  {m.snapshot.value === null ? "—" : Number(m.snapshot.value)}
                  {m.snapshot.n_records !== null && (
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      n={m.snapshot.n_records}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-amber-700">{m.absence}</p>
              )}
            </div>
            {m.target && <p className="mt-1 text-xs text-slate-500">Target: {m.target}</p>}
            <p className="mt-2 text-xs leading-5 text-slate-500">{m.definition}</p>
            {m.sites.length > 0 && (
              <table className="mt-3 text-xs">
                <thead>
                  <tr className="text-left uppercase tracking-wide text-slate-400">
                    <th className="pr-6 py-1">Site</th>
                    <th className="pr-6 py-1">Value</th>
                    <th className="pr-6 py-1">n</th>
                  </tr>
                </thead>
                <tbody>
                  {m.sites.map((s) => (
                    <tr key={s.site_number}>
                      <td className="pr-6 py-0.5">{s.site_number}</td>
                      <td className="pr-6 py-0.5">{s.value === null ? "—" : Number(s.value)}</td>
                      <td className="pr-6 py-0.5">{s.n_records ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </section>

      <section className="text-xs text-slate-500">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Provenance
        </h2>
        <p>
          Generated {new Date(pack.generated_at).toLocaleString()} by {pack.generated_by}. Metric
          definitions are the registered copies at the computed version (ADR-0004); snapshots are
          immutable rows citing the extracts below (ADR-0007).
        </p>
        {pack.provenance.extracts.length > 0 && (
          <table className="mt-2 w-full">
            <thead>
              <tr className="text-left uppercase tracking-wide text-slate-400">
                <th className="pr-4 py-1">Adapter</th>
                <th className="pr-4 py-1">Extracted</th>
                <th className="py-1">Checksum</th>
              </tr>
            </thead>
            <tbody>
              {pack.provenance.extracts.map((e) => (
                <tr key={e.id}>
                  <td className="pr-4 py-0.5">{e.adapter}</td>
                  <td className="pr-4 py-0.5">{new Date(e.extracted_at).toLocaleString()}</td>
                  <td className="py-0.5 font-mono break-all">{e.checksum}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
