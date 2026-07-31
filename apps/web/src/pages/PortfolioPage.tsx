import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type ApiError, type Portfolio, type PortfolioMetric, api, downloadCsv } from "../api";
import { ErrorNote, Sparkline, Spinner } from "../components";

/**
 * The portfolio roll-up (ADR-0015). Everything here derives from stored
 * study snapshots: pooled values only where the math is exact, the
 * per-study spread where it is not, and the lock-readiness burn-up from
 * the monthly DM-Q9 snapshots.
 */
export function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    api
      .portfolio()
      .then(setPortfolio)
      .catch((e: ApiError) => setError(e));
  }, []);

  if (error) {
    return error.status === 403 ? (
      <div className="rounded border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">
        <p className="font-medium text-slate-900">The portfolio view needs a qa or admin seat.</p>
        <p className="mt-1">
          The portfolio number is one fact for the whole portfolio, so it is only served to roles
          that can read every study (DM-P5). Your assigned studies are on the{" "}
          <Link to="/" className="text-sky-700 hover:underline">
            Studies
          </Link>{" "}
          page.
        </p>
      </div>
    ) : (
      <ErrorNote message={error.message} />
    );
  }
  if (!portfolio) return <Spinner label="Loading portfolio…" />;

  const dmMetrics = portfolio.metrics.filter((m) => m.module === "dm");
  const statMetrics = portfolio.metrics.filter((m) => m.module === "stat");

  return (
    <div>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">
          Portfolio
          <button
            type="button"
            onClick={() => downloadCsv("/portfolio.csv").catch(() => {})}
            className="ml-3 rounded border border-slate-300 px-3 py-1 text-sm font-normal text-slate-600 hover:border-sky-300 hover:text-slate-900"
          >
            CSV
          </button>
        </h1>
        <p className="text-sm text-slate-500">
          {portfolio.studies.total} studies
          {Object.entries(portfolio.studies.by_status).map(([status, n]) => (
            <span key={status} className="ml-2 text-xs text-slate-400 capitalize">
              {n} {status}
            </span>
          ))}
          {portfolio.studies.stat_enabled > 0 && (
            <span className="ml-2 text-xs text-slate-400">
              {portfolio.studies.stat_enabled} stat-enabled
            </span>
          )}
        </p>
      </div>

      <LockSection lock={portfolio.lock} />

      <MetricSection title="Data management" metrics={dmMetrics} />
      {statMetrics.length > 0 && (
        <MetricSection title="Statistical programming" metrics={statMetrics} />
      )}
    </div>
  );
}

function LockSection({ lock }: { lock: Portfolio["lock"] }) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Lock readiness
          </h2>
          <p className="mt-1 text-3xl font-semibold">
            {lock.readiness_pct === null ? "—" : `${lock.readiness_pct}%`}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {lock.gates_satisfied} of {lock.gates_applicable} gates satisfied across{" "}
              {lock.studies} studies
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {lock.studies_with_blocked_gates > 0 && (
              <span className="mr-3 rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700">
                {lock.studies_with_blocked_gates} with blocked gates
              </span>
            )}
            {lock.studies_locked} locked
          </p>
        </div>
        <div title="One pooled point per reporting period from the monthly lock_readiness_pct snapshots (ADR-0015)">
          <p className="mb-1 text-xs text-slate-400">Readiness burn-up</p>
          <Sparkline points={lock.trend.map((t) => ({ x: t.period_start, y: t.readiness_pct }))} />
        </div>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-4">Protocol</th>
            <th className="py-2 pr-4">Readiness</th>
            <th className="py-2 pr-4">Gates</th>
            <th className="py-2 pr-4">Next gate</th>
            <th className="py-2 pr-4">Lock planned</th>
            <th className="py-2 pr-4">Forecast</th>
            <th className="py-2">Actual</th>
          </tr>
        </thead>
        <tbody>
          {lock.per_study.map((s) => (
            <tr key={s.study_id} className="border-b border-slate-100 last:border-0">
              <td className="py-2 pr-4 font-medium">
                <Link to={`/studies/${s.study_id}`} className="text-sky-700 hover:underline">
                  {s.protocol_number}
                </Link>
              </td>
              <td className="py-2 pr-4">
                {s.readiness_pct === null ? "—" : `${s.readiness_pct}%`}
                {s.gates_blocked > 0 && (
                  <span className="ml-2 rounded bg-rose-100 px-1.5 text-xs font-medium text-rose-700">
                    {s.gates_blocked} blocked
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 text-slate-500">
                {s.gates_satisfied}/{s.gates_applicable}
              </td>
              <td className="py-2 pr-4 text-slate-500">{s.next_gate_label ?? "—"}</td>
              <td className="py-2 pr-4 text-slate-500">{s.lock_planned_date ?? "—"}</td>
              <td className="py-2 pr-4 text-slate-500">{s.lock_forecast_date ?? "—"}</td>
              <td className="py-2 text-slate-500">{s.lock_actual_date ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MetricSection({ title, metrics }: { title: string; metrics: PortfolioMetric[] }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => (
          <MetricCard key={m.metric_id} metric={m} />
        ))}
      </div>
    </section>
  );
}

function MetricCard({ metric: m }: { metric: PortfolioMetric }) {
  const asOf =
    m.earliest_period_end === null
      ? null
      : m.earliest_period_end === m.latest_period_end
        ? `as of ${m.latest_period_end}`
        : `as of ${m.earliest_period_end} – ${m.latest_period_end}`;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-700">{m.label}</h3>
        <span className="text-xs text-slate-400">v{m.version}</span>
      </div>
      {m.pooled ? (
        <p className="mt-2 text-2xl font-semibold">
          {m.pooling === "ratio" ? (
            <>
              {m.pooled.pct === null ? "—" : `${m.pooled.pct}%`}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {m.pooled.numerator} of {m.pooled.denominator}
              </span>
            </>
          ) : (
            <>
              {m.pooled.numerator}
              <span className="ml-2 text-sm font-normal text-slate-500">
                of {m.pooled.denominator}
              </span>
            </>
          )}
        </p>
      ) : m.studies_reporting === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No snapshots yet.</p>
      ) : (
        // The honest alternative to a fake pooled median (ADR-0015):
        // a named reason and the per-study spread.
        <div className="mt-2">
          <p className="text-xs text-slate-400" title={m.not_pooled_reason ?? undefined}>
            {m.pooling === "median"
              ? "Medians don't pool — per-study values:"
              : m.not_pooled_reason}
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {m.per_study.map((s) => (
              <li key={s.study_id} className="flex justify-between">
                <span className="text-slate-500">{s.protocol_number}</span>
                <span className="font-medium">{s.value ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">
        <span className={m.studies_reporting < m.studies_in_scope ? "text-amber-600" : ""}>
          {m.studies_reporting} of {m.studies_in_scope} studies reporting
        </span>
        {asOf && <span className="ml-2">{asOf}</span>}
      </p>
      {m.target && <p className="mt-1 text-xs text-slate-400">Target: {m.target}</p>}
    </div>
  );
}
