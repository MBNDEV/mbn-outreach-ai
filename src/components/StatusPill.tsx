const STYLES: Record<string, string> = {
  // campaign
  draft: "bg-slate-100 text-slate-600",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  completed: "bg-indigo-50 text-indigo-700",
  // accounts
  connected: "bg-emerald-50 text-emerald-700",
  pending: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
  // leads
  in_sequence: "bg-indigo-50 text-indigo-700",
  replied: "bg-emerald-50 text-emerald-700",
  bounced: "bg-red-50 text-red-700",
  unsubscribed: "bg-slate-100 text-slate-500",
  stopped: "bg-slate-100 text-slate-500",
};

export default function StatusPill({ status, title }: { status: string; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STYLES[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
