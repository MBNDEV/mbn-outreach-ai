import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { planLimits } from "@/lib/plans";

export default async function DashboardPage() {
  const { workspace } = await requireWorkspace();
  const limits = planLimits(workspace.plan);

  const startOfDay = new Date();
  startOfDay.setHours(startOfDay.getHours() - 24);
  const [accountCount, connectedCount, memberCount, activeCampaigns, sent24h] =
    await Promise.all([
      db.emailAccount.count({ where: { workspaceId: workspace.id } }),
      db.emailAccount.count({ where: { workspaceId: workspace.id, status: "connected" } }),
      db.membership.count({ where: { workspaceId: workspace.id } }),
      db.campaign.count({ where: { workspaceId: workspace.id, status: "active" } }),
      db.message.count({ where: { workspaceId: workspace.id, sentAt: { gte: startOfDay } } }),
    ]);

  const stats = [
    { label: "Email accounts", value: `${accountCount} / ${limits.maxEmailAccounts}` },
    { label: "Connected & healthy", value: String(connectedCount) },
    { label: "Active campaigns", value: String(activeCampaigns) },
    { label: "Sent (24h)", value: String(sent24h) },
    { label: "Members", value: `${memberCount} / ${limits.maxMembers}` },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Dashboard</h1>
      <div className="mb-8 grid grid-cols-5 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{s.value}</p>
          </div>
        ))}
      </div>
      {accountCount === 0 && (
        <div className="max-w-3xl rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <h2 className="text-lg font-medium">Connect your first sending account</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
            Campaigns need at least one connected mailbox. Connect Google,
            Microsoft, or any SMTP provider — or bulk-import from CSV.
          </p>
          <Link
            href="/accounts/new"
            className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
          >
            Connect an account
          </Link>
        </div>
      )}
    </div>
  );
}
