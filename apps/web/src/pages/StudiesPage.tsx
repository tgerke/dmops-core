import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type ApiError, type StudySummary, api } from "../api";
import { ErrorNote, Spinner } from "../components";

export function StudiesPage() {
  const [studies, setStudies] = useState<StudySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .studies()
      .then(setStudies)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) return <ErrorNote message={error} />;
  if (!studies) return <Spinner label="Loading studies…" />;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Studies</h1>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2">Protocol</th>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Phase</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">DM lead</th>
              <th className="px-4 py-2">Milestones</th>
              <th className="px-4 py-2">Next up</th>
            </tr>
          </thead>
          <tbody>
            {studies.map((s) => (
              <tr
                key={s.study_id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-medium">
                  <Link to={`/studies/${s.study_id}`} className="text-sky-700 hover:underline">
                    {s.protocol_number}
                  </Link>
                </td>
                <td className="max-w-xs truncate px-4 py-3 text-slate-600">{s.short_title}</td>
                <td className="px-4 py-3">{s.phase}</td>
                <td className="px-4 py-3 capitalize">{s.study_status}</td>
                <td className="px-4 py-3">{s.dm_lead_name}</td>
                <td className="px-4 py-3">
                  <ProgressCell study={s} />
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {s.next_milestone_label ? (
                    <>
                      {s.next_milestone_label}
                      {s.next_milestone_planned && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({s.next_milestone_planned})
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProgressCell({ study }: { study: StudySummary }) {
  const pct = study.pct_complete ?? 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded bg-slate-100">
        <div className="h-full rounded bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500">
        {study.milestone_complete}/{study.milestone_total - study.milestone_na}
      </span>
      {study.milestone_blocked > 0 && (
        <span className="rounded bg-rose-100 px-1.5 text-xs font-medium text-rose-700">
          {study.milestone_blocked} blocked
        </span>
      )}
    </div>
  );
}
