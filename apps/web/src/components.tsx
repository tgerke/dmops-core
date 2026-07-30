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
