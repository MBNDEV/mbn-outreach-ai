import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { memoryContext, MEMORY_KINDS } from "@/lib/agent/memory";
import { POSITIVE_LABELS } from "@/lib/labels";
import { resolveTaskAction } from "@/lib/actions/agents";
import AgentControls from "@/components/AgentControls";
import AgentSettingsForm from "@/components/AgentSettingsForm";
import MemoryEditor from "@/components/MemoryEditor";
import StatusPill from "@/components/StatusPill";
import { IconChevronLeft } from "@/components/icons";

// Minutes of human work each agent action stands in for. Shown with the estimate
// so the number is arguable rather than mysterious.
const MINUTES_PER_LEAD = 2;
const MINUTES_PER_REPLY = 4;

const EVENT_STYLES: Record<string, string> = {
  proposed: "bg-indigo-50 text-indigo-700",
  queued: "bg-emerald-50 text-emerald-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-slate-100 text-slate-600",
  escalated: "bg-amber-50 text-amber-800",
  campaign_created: "bg-indigo-50 text-indigo-700",
  error: "bg-red-50 text-red-700",
  idle: "bg-slate-100 text-slate-600",
  status: "bg-slate-100 text-slate-600",
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace, role } = await requireWorkspace();
  const canManage = role !== "member";

  const agent = await db.agent.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!agent) notFound();

  const [tasks, events, memory, context, counts, campaign] = await Promise.all([
    db.agentTask.findMany({
      where: { agentId: agent.id, status: "pending" },
      orderBy: { createdAt: "asc" },
      include: {
        lead: { select: { email: true, firstName: true, lastName: true, company: true, title: true } },
        // Thread subject is what tells a human which conversation to open.
      },
      take: 50,
    }),
    db.agentEvent.findMany({
      where: { agentId: agent.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.memoryRecord.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    }),
    memoryContext(workspace.id),
    db.agentTask.groupBy({
      by: ["type", "status"],
      where: { agentId: agent.id },
      _count: true,
    }),
    agent.campaignId
      ? db.campaign.findUnique({
          where: { id: agent.campaignId },
          select: {
            id: true,
            name: true,
            status: true,
            _count: { select: { leads: true } },
          },
        })
      : null,
  ]);

  const countOf = (type: string, status?: string) =>
    counts
      .filter((row) => row.type === type && (!status || row.status === status))
      .reduce((total, row) => total + row._count, 0);

  const [sent, replies, positive] = await Promise.all([
    agent.campaignId
      ? db.message.count({ where: { campaignId: agent.campaignId, direction: "out" } })
      : 0,
    agent.campaignId
      ? db.message.count({
          where: { campaignId: agent.campaignId, direction: "in", kind: "reply" },
        })
      : 0,
    agent.campaignId
      ? db.thread.count({
          where: { campaignId: agent.campaignId, label: { in: POSITIVE_LABELS } },
        })
      : 0,
  ]);

  const proposed = countOf("lead_approval");
  const approved = countOf("lead_approval", "approved");
  const interventions = countOf("reply_escalation");
  const minutesSaved = proposed * MINUTES_PER_LEAD + replies * MINUTES_PER_REPLY;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href="/agents"
            aria-label="Back to agents"
            className="mt-0.5 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <IconChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight">{agent.name}</h1>
              <StatusPill status={agent.status} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {campaign ? (
                <>
                  Feeding{" "}
                  <Link
                    href={`/campaigns/${campaign.id}`}
                    className="text-indigo-700 hover:underline"
                  >
                    {campaign.name}
                  </Link>{" "}
                  ({campaign.status}, {campaign._count.leads} leads)
                </>
              ) : (
                "No campaign yet — it builds one on the first run."
              )}
            </p>
          </div>
        </div>
        {canManage && <AgentControls agentId={agent.id} status={agent.status} />}
      </div>

      {!context.complete && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Memory is incomplete, so generated copy would be guesswork. Fill in the business, an
          offer and an ideal customer under{" "}
          <Link href="/business" className="font-medium underline">
            Your business
          </Link>{" "}
          — the agent falls back to a generic template until you do.
        </p>
      )}

      <div className="grid grid-cols-6 gap-3">
        <Stat label="Proposed" value={String(proposed)} />
        <Stat
          label="Approved"
          value={String(approved)}
          sub={proposed > 0 ? `${Math.round((approved / proposed) * 100)}% of proposals` : undefined}
        />
        <Stat label="Emails sent" value={String(sent)} />
        <Stat
          label="Replies"
          value={String(replies)}
          sub={sent > 0 ? `${Math.round((replies / sent) * 100)}% reply rate` : undefined}
        />
        <Stat label="Positive" value={String(positive)} />
        <Stat
          label="Handed to you"
          value={String(interventions)}
          sub={`~${Math.round(minutesSaved / 60)}h saved`}
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold">Waiting on you</h2>
          <p className="text-xs text-slate-500">
            ~{MINUTES_PER_LEAD} min saved per lead, {MINUTES_PER_REPLY} per reply triaged
          </p>
        </div>
        {tasks.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            Nothing pending. {agent.status === "paused" ? "The agent is paused." : "It will add to this queue as it finds leads."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {task.type === "lead_approval"
                      ? task.lead
                        ? `${[task.lead.firstName, task.lead.lastName].filter(Boolean).join(" ") || task.lead.email}`
                        : "Lead"
                      : "Reply needs you"}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {task.lead?.email ? `${task.lead.email} · ` : ""}
                    {task.note}
                  </p>
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <form action={resolveTaskAction}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <button className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-700">
                        {task.type === "lead_approval" ? "Approve" : "Got it"}
                      </button>
                    </form>
                    {task.type === "lead_approval" && (
                      <form action={resolveTaskAction}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="decision" value="reject" />
                        <button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium transition hover:bg-slate-50">
                          Skip
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-2 gap-6">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold">Activity</h2>
          </div>
          {events.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {events.map((event) => (
                <li key={event.id} className="flex gap-3 px-5 py-2.5">
                  <span
                    className={`mt-0.5 h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      EVENT_STYLES[event.kind] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {event.kind.replace(/_/g, " ")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-700">{event.message}</p>
                    <p className="text-xs text-slate-400">{event.createdAt.toLocaleString()}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {canManage && (
            <AgentSettingsForm
              agent={{
                id: agent.id,
                name: agent.name,
                icp: agent.icp,
                dailyLeadTarget: agent.dailyLeadTarget,
                autoApprove: agent.autoApprove,
              }}
            />
          )}
          <MemoryEditor
            kinds={MEMORY_KINDS.map((kind) => ({ ...kind }))}
            records={memory.map((record) => ({
              id: record.id,
              kind: record.kind,
              content: record.content,
              enabled: record.enabled,
            }))}
            canManage={canManage}
          />
        </div>
      </div>
    </div>
  );
}
