const statusStyles: Record<string, { label: string; className: string }> = {
  not_started: { label: "Not started", className: "bg-slate-100 text-slate-500" },
  in_progress: { label: "In progress", className: "bg-sky-100 text-sky-700" },
  complete: { label: "Complete", className: "bg-emerald-100 text-emerald-700" },
  blocked: { label: "Blocked", className: "bg-rose-100 text-rose-700" },
  na: { label: "N/A", className: "bg-slate-50 text-slate-400 line-through" },
};

export function StatusChip({ status }: { status: string }) {
  const style = statusStyles[status] ?? statusStyles.not_started!;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function SlipBadge({ days }: { days: number | null }) {
  if (days === null || days === 0) return null;
  return days > 0 ? (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
      +{days}d
    </span>
  ) : (
    <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-600">
      {days}d
    </span>
  );
}

const deliverableStatusStyles: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-slate-100 text-slate-500" },
  in_review: { label: "In review", className: "bg-sky-100 text-sky-700" },
  approved: { label: "Approved", className: "bg-emerald-100 text-emerald-700" },
  superseded: { label: "Superseded", className: "bg-slate-50 text-slate-400 line-through" },
};

export function DeliverableChip({ status }: { status: string }) {
  const style = deliverableStatusStyles[status] ?? deliverableStatusStyles.draft!;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

const uatCycleStatusStyles: Record<string, { label: string; className: string }> = {
  planned: { label: "Planned", className: "bg-slate-100 text-slate-500" },
  in_progress: { label: "In progress", className: "bg-sky-100 text-sky-700" },
  complete: { label: "Complete", className: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "Cancelled", className: "bg-slate-50 text-slate-400 line-through" },
};

export function UatCycleChip({ status }: { status: string }) {
  const style = uatCycleStatusStyles[status] ?? uatCycleStatusStyles.planned!;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

const defectStatusStyles: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-rose-100 text-rose-700" },
  resolved: { label: "Resolved", className: "bg-amber-100 text-amber-700" },
  closed: { label: "Closed", className: "bg-emerald-100 text-emerald-700" },
  withdrawn: { label: "Withdrawn", className: "bg-slate-50 text-slate-400 line-through" },
};

export function DefectChip({ status }: { status: string }) {
  const style = defectStatusStyles[status] ?? defectStatusStyles.open!;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}
    >
      {style.label}
    </span>
  );
}

const severityStyles: Record<string, string> = {
  critical: "bg-rose-100 text-rose-700",
  major: "bg-amber-100 text-amber-700",
  minor: "bg-slate-100 text-slate-500",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${severityStyles[severity] ?? severityStyles.minor}`}
    >
      {severity}
    </span>
  );
}

/** Inline SVG trend of snapshot values over reporting periods. */
export function Sparkline({ points }: { points: { x: string; y: number | null }[] }) {
  const values = points.map((p) => p.y).filter((y): y is number => y !== null);
  if (points.length < 2 || values.length === 0) {
    return <p className="text-xs text-slate-400">Not enough history for a trend yet.</p>;
  }
  const w = 260;
  const h = 56;
  const pad = 6;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const px = (i: number) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const py = (v: number) => h - pad - ((v - min) * (h - 2 * pad)) / span;
  // null values break the line rather than interpolating through them
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.y === null) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
    } else {
      current.push(`${px(i)},${py(p.y)}`);
    }
  });
  if (current.length > 1) segments.push(current.join(" "));
  return (
    <div className="flex items-end gap-2">
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="metric trend"
        className="text-sky-600"
      >
        {segments.map((s) => (
          <polyline key={s} points={s} fill="none" stroke="currentColor" strokeWidth="1.5" />
        ))}
        {points.map(
          (p, i) =>
            p.y !== null && (
              <circle key={p.x} cx={px(i)} cy={py(p.y)} r="2.5" fill="currentColor">
                <title>{`${p.x}: ${p.y}`}</title>
              </circle>
            ),
        )}
      </svg>
      <div className="text-xs text-slate-400">
        <p>max {max}</p>
        <p>min {min}</p>
      </div>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{label}</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}
