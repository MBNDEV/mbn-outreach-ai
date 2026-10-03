import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db, icontains } from "@/lib/db";
import { THREAD_LABELS } from "@/lib/labels";
import { syncNowAction, markThreadReadAction } from "@/lib/actions/unibox";
import {
  LabelPicker,
  DoneToggle,
  ReminderPicker,
  ReplyComposer,
} from "@/components/ThreadControls";
import { IconMail } from "@/components/icons";

const LABEL_PILL: Record<string, string> = {
  interested: "bg-emerald-50 text-emerald-700",
  meeting_booked: "bg-indigo-50 text-indigo-700",
  meeting_completed: "bg-indigo-50 text-indigo-700",
  won: "bg-emerald-50 text-emerald-700",
  out_of_office: "bg-amber-50 text-amber-700",
  wrong_person: "bg-slate-100 text-slate-600",
  not_interested: "bg-red-50 text-red-700",
  lost: "bg-red-50 text-red-700",
  lead: "bg-sky-50 text-sky-700",
};

export default async function UniboxPage({
  searchParams,
}: {
  searchParams: Promise<{ label?: string; view?: string; q?: string; t?: string }>;
}) {
  const { workspace } = await requireWorkspace();
  const { label, view, q, t } = await searchParams;

  const where = {
    workspaceId: workspace.id,
    ...(label ? { label } : {}),
    ...(view === "done" ? { done: true } : { done: false }),
    ...(view === "unread" ? { unread: true } : {}),
    ...(view === "reminders" ? { reminderAt: { not: null } } : {}),
    ...(q ? { OR: [{ contactEmail: icontains(q) }, { subject: icontains(q) }] } : {}),
  };

  const [threads, labelCounts] = await Promise.all([
    db.thread.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take: 100,
    }),
    db.thread.groupBy({
      by: ["label"],
      where: { workspaceId: workspace.id, done: false },
      _count: true,
    }),
  ]);

  const active = t ? threads.find((th) => th.id === t) ?? null : null;
  const messages = active
    ? await db.message.findMany({
        where: { threadId: active.id },
        orderBy: { sentAt: "asc" },
      })
    : [];
  if (active?.unread) await markThreadReadAction(active.id);

  const countFor = (id: string) => labelCounts.find((c) => c.label === id)?._count ?? 0;
  const qs = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ label, view, q, t, ...patch })) {
      if (v) params.set(k, v);
    }
    const s = params.toString();
    return s ? `/unibox?${s}` : "/unibox";
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Unibox</h1>
        <form action={syncNowAction}>
          <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-slate-50">
            Sync now
          </button>
        </form>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {THREAD_LABELS.map((l) => (
          <Link
            key={l.id}
            href={qs({ label: label === l.id ? undefined : l.id, t: undefined })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              label === l.id
                ? "bg-indigo-600 text-white"
                : `${LABEL_PILL[l.id] ?? "bg-slate-100 text-slate-600"} hover:opacity-80`
            }`}
          >
            {l.label}
            {countFor(l.id) > 0 && <span className="ml-1 tabular-nums">{countFor(l.id)}</span>}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-200" />
        {(
          [
            ["", "Open"],
            ["unread", "Unread"],
            ["reminders", "Reminders"],
            ["done", "Done"],
          ] as const
        ).map(([v, lbl]) => (
          <Link
            key={v}
            href={qs({ view: v || undefined, t: undefined })}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              (view ?? "") === v
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
            }`}
          >
            {lbl}
          </Link>
        ))}
      </div>

      <div className="grid h-[calc(100vh-220px)] grid-cols-[360px_1fr] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {/* Thread list */}
        <div className="overflow-y-auto border-r border-slate-100">
          {threads.length === 0 ? (
            <div className="p-10 text-center">
              <IconMail className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-700">Your unibox is empty</p>
              <p className="mt-1 text-xs text-slate-500">
                Replies to your campaigns will land here from every connected mailbox.
              </p>
            </div>
          ) : (
            threads.map((th) => (
              <Link
                key={th.id}
                href={qs({ t: th.id })}
                className={`block border-b border-slate-50 px-4 py-3 transition-colors ${
                  active?.id === th.id ? "bg-indigo-50/60" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`truncate text-sm ${th.unread ? "font-semibold text-slate-900" : "font-medium text-slate-700"}`}
                  >
                    {th.contactEmail}
                  </p>
                  <span className="shrink-0 text-xs text-slate-400">
                    {th.lastMessageAt.toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{th.subject || "(no subject)"}</p>
                <div className="mt-1 flex items-center gap-2">
                  {th.label && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${LABEL_PILL[th.label] ?? "bg-slate-100 text-slate-600"}`}
                    >
                      {th.label.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className="truncate text-xs text-slate-400">{th.snippet}</span>
                </div>
              </Link>
            ))
          )}
        </div>

        {/* Thread detail */}
        <div className="flex min-w-0 flex-col">
          {!active ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Select a conversation
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{active.contactEmail}</p>
                  <p className="truncate text-xs text-slate-500">{active.subject}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <LabelPicker threadId={active.id} label={active.label} />
                  <ReminderPicker
                    threadId={active.id}
                    reminderAt={
                      active.reminderAt
                        ? new Date(
                            active.reminderAt.getTime() -
                              active.reminderAt.getTimezoneOffset() * 60_000
                          )
                            .toISOString()
                            .slice(0, 16)
                        : null
                    }
                  />
                  <DoneToggle threadId={active.id} done={active.done} />
                </div>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      m.direction === "out"
                        ? "ml-auto bg-indigo-600 text-white"
                        : "bg-slate-100 text-slate-800"
                    }`}
                  >
                    <p
                      className={`mb-1 text-[11px] ${m.direction === "out" ? "text-indigo-200" : "text-slate-500"}`}
                    >
                      {m.direction === "out" ? m.fromEmail || "You" : m.fromEmail} ·{" "}
                      {m.sentAt.toLocaleString()}
                      {m.kind !== "normal" && m.kind !== "reply" && ` · ${m.kind.replace("_", " ")}`}
                    </p>
                    <div className="whitespace-pre-wrap">{m.bodyText || m.subject}</div>
                  </div>
                ))}
              </div>
              <ReplyComposer threadId={active.id} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
