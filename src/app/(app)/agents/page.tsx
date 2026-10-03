import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { createAgentAction } from "@/lib/actions/agents";
import StatusPill from "@/components/StatusPill";

export default async function AgentsPage() {
  const { workspace, role } = await requireWorkspace();
  const canManage = role !== "member";

  const agents = await db.agent.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { tasks: true } },
    },
  });

  const pending = await db.agentTask.groupBy({
    by: ["agentId"],
    where: { workspaceId: workspace.id, status: "pending" },
    _count: true,
  });
  const pendingFor = (agentId: string) =>
    pending.find((row) => row.agentId === agentId)?._count ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="mt-1 text-sm text-slate-500">
            An agent works the loop for you: find leads, ask you to approve them, queue the
            approved ones into its own campaign, and hand back anyone who replies.
          </p>
        </div>
        {canManage && (
          <form action={createAgentAction} className="flex items-end gap-2">
            <input
              name="name"
              placeholder="Sales agent"
              className="w-48 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
              New agent
            </button>
          </form>
        )}
      </div>

      {agents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-sm text-slate-600">
            No agents yet. Create one, fill in what it should know about your business, then
            resume it when you are happy with the settings.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {agents.map((agent) => {
            const waiting = pendingFor(agent.id);
            return (
              <li
                key={agent.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <Link
                        href={`/agents/${agent.id}`}
                        className="truncate text-sm font-semibold text-indigo-700 hover:underline"
                      >
                        {agent.name}
                      </Link>
                      <StatusPill status={agent.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Target {agent.dailyLeadTarget} leads/day ·{" "}
                      {agent.autoApprove ? "auto-approves" : "asks before sending"} ·{" "}
                      {agent.lastRunAt ? `last ran ${agent.lastRunAt.toLocaleString()}` : "never run"}
                    </p>
                  </div>
                  {waiting > 0 && (
                    <Link
                      href={`/agents/${agent.id}`}
                      className="shrink-0 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
                    >
                      {waiting} waiting on you
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
