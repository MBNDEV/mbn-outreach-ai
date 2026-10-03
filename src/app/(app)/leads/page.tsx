import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db, icontains } from "@/lib/db";
import { createListAction, deleteLeadAction } from "@/lib/actions/leads";
import { ImportPanel, BulkActions } from "@/components/LeadsToolbar";
import { IconUsers } from "@/components/icons";

const VERIFY_PILL: Record<string, string> = {
  valid: "bg-emerald-50 text-emerald-700",
  risky: "bg-amber-50 text-amber-700",
  invalid: "bg-red-50 text-red-700",
  unverified: "bg-slate-100 text-slate-500",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; list?: string }>;
}) {
  const { workspace, role } = await requireWorkspace();
  const { q, list } = await searchParams;

  const [leads, lists, campaigns, total] = await Promise.all([
    db.lead.findMany({
      where: {
        workspaceId: workspace.id,
        ...(list ? { listItems: { some: { listId: list } } } : {}),
        ...(q
          ? {
              OR: [
                { email: icontains(q) },
                { company: icontains(q) },
                { firstName: icontains(q) },
                { lastName: icontains(q) },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { _count: { select: { campaignLeads: true } } },
    }),
    db.leadList.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { items: true } } },
    }),
    db.campaign.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
    db.lead.count({ where: { workspaceId: workspace.id } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {total} lead{total === 1 ? "" : "s"} in this workspace ·{" "}
            {workspace.credits.toLocaleString()} credits
          </p>
        </div>
        <Link
          href="/leads/search"
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
        >
          Find leads
        </Link>
      </div>

      <div className="mb-5 space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <ImportPanel lists={lists.map((l) => ({ id: l.id, name: l.name }))} />
        <BulkActions q={q} listId={list} campaigns={campaigns} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex gap-2" action="/leads" method="get">
          {list && <input type="hidden" name="list" value={list} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search leads…"
            className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <button className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-slate-50">
            Search
          </button>
        </form>
        <span className="mx-1 h-4 w-px bg-slate-200" />
        <Link
          href="/leads"
          className={`rounded-full px-3 py-1 text-xs font-medium ${!list ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
        >
          All
        </Link>
        {lists.map((l) => (
          <Link
            key={l.id}
            href={`/leads?list=${l.id}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${list === l.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {l.name} <span className="tabular-nums">{l._count.items}</span>
          </Link>
        ))}
        <form action={createListAction} className="ml-1 flex gap-2">
          <input
            name="name"
            placeholder="New list…"
            className="w-32 rounded-lg border border-slate-200 px-2.5 py-1 text-xs shadow-sm"
          />
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium shadow-sm hover:bg-slate-50">
            Create
          </button>
        </form>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-14 text-center">
          <IconUsers className="mx-auto h-8 w-8 text-slate-300" />
          <h2 className="mt-3 text-lg font-medium">No leads found</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
            Import a CSV above — leads are shared across campaigns.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Title</th>
                <th className="px-5 py-3">Verification</th>
                <th className="px-5 py-3">Campaigns</th>
                {role !== "member" && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-medium text-slate-900">{l.email}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {[l.firstName, l.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{l.company || "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{l.title || "—"}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${VERIFY_PILL[l.verifyStatus]}`}
                    >
                      {l.verifyStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">
                    {l._count.campaignLeads}
                  </td>
                  {role !== "member" && (
                    <td className="px-5 py-3 text-right">
                      <form action={deleteLeadAction}>
                        <input type="hidden" name="id" value={l.id} />
                        <button className="text-xs font-medium text-red-600 hover:text-red-800">
                          Delete
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
