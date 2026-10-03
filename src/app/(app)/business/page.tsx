import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { memoryContext, MEMORY_KINDS } from "@/lib/agent/memory";
import MemoryEditor from "@/components/MemoryEditor";

// What the workspace sells, and to whom. Campaign copy, the AI sequence
// generator and every agent read from here, so it belongs in the nav in its
// own right rather than inside an agent's settings.

export default async function BusinessPage() {
  const { workspace, role } = await requireWorkspace();
  const canManage = role !== "member";

  const [records, context, agentCount] = await Promise.all([
    db.memoryRecord.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    }),
    memoryContext(workspace.id),
    db.agent.count({ where: { workspaceId: workspace.id } }),
  ]);

  const missing = [
    context.business ? null : "what the business does",
    context.offers.length > 0 ? null : "at least one offer",
    context.icps.length > 0 ? null : "at least one ideal customer",
  ].filter(Boolean);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your business</h1>
        <p className="mt-1 text-sm text-slate-500">
          What you do, what you sell, and who you sell it to. Generated campaign copy, the
          copilot and every agent read from this — fill it in before writing a sequence and the
          wording comes out in your own terms rather than generic.
        </p>
      </div>

      {missing.length > 0 ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Still missing {missing.join(", ")}. Until then, generated copy falls back to a generic
          template.
        </p>
      ) : (
        <p className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">
          Enough here to write copy from — {context.offers.length} offer
          {context.offers.length === 1 ? "" : "s"} and {context.icps.length} ideal customer
          {context.icps.length === 1 ? "" : "s"} on file.
        </p>
      )}

      <MemoryEditor
        kinds={MEMORY_KINDS.map((kind) => ({ ...kind }))}
        records={records.map((record) => ({
          id: record.id,
          kind: record.kind,
          content: record.content,
          enabled: record.enabled,
        }))}
        canManage={canManage}
      />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">What reads this</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
          <li>
            <span className="text-slate-400">—</span> The{" "}
            <Link href="/campaigns" className="text-indigo-600 hover:underline">
              sequence generator
            </Link>
            , when you ask it to write a campaign.
          </li>
          <li>
            <span className="text-slate-400">—</span> The copilot, via the sparkle button in the
            bottom-right corner of any page.
          </li>
          <li>
            <span className="text-slate-400">—</span>{" "}
            <Link href="/agents" className="text-indigo-600 hover:underline">
              Agents
            </Link>
            {agentCount === 0
              ? " — none yet; one will use this to write its own campaign."
              : ` — ${agentCount} using it to write their campaigns.`}
          </li>
        </ul>
      </div>
    </div>
  );
}
