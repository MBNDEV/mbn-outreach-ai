import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db, icontains } from "@/lib/db";
import { createCampaignAction } from "@/lib/actions/campaigns";
import StatusPill from "@/components/StatusPill";
import { IconPlus, IconSend } from "@/components/icons";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { workspace } = await requireWorkspace();
  const { q, status } = await searchParams;

  const campaigns = await db.campaign.findMany({
    where: {
      workspaceId: workspace.id,
      ...(status ? { status } : {}),
      ...(q ? { name: icontains(q) } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { leads: true, messages: true } },
    },
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <form action={createCampaignAction}>
          <button className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500">
            <IconPlus className="h-4 w-4" />
            Create campaign
          </button>
        </form>
      </div>

      <form className="mb-5 flex gap-3" action="/campaigns" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search campaigns…"
          className="w-72 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
        </select>
        <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-slate-50">
          Filter
        </button>
      </form>

      {campaigns.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-14 text-center">
          <IconSend className="mx-auto h-8 w-8 text-slate-300" />
          <h2 className="mt-3 text-lg font-medium">No campaigns yet</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Create your first campaign to start writing a sequence and adding leads.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Leads</th>
                <th className="px-5 py-3">Emails sent</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/50">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/campaigns/${c.id}/editor`}
                      className="font-medium text-slate-900 hover:text-indigo-600"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="px-5 py-3.5 tabular-nums">{c._count.leads}</td>
                  <td className="px-5 py-3.5 tabular-nums">{c._count.messages}</td>
                  <td className="px-5 py-3.5 text-slate-500">
                    {c.createdAt.toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
