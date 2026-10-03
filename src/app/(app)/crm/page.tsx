import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { createOpportunityAction } from "@/lib/actions/crm";
import OpportunityCard from "@/components/OpportunityCard";

const COLUMNS = [
  { id: "interested", label: "Interested", weight: 0.25 },
  { id: "meeting_booked", label: "Meeting booked", weight: 0.5 },
  { id: "meeting_completed", label: "Meeting completed", weight: 0.75 },
  { id: "won", label: "Won", weight: 1 },
];

export default async function CrmPage() {
  const { workspace } = await requireWorkspace();
  const opportunities = await db.opportunity.findMany({
    where: { workspaceId: workspace.id, stage: { not: "lost" } },
    orderBy: { updatedAt: "desc" },
  });

  const byStage = (stage: string) => opportunities.filter((o) => o.stage === stage);
  const weighted = COLUMNS.reduce(
    (sum, col) => sum + byStage(col.id).reduce((s, o) => s + o.value, 0) * col.weight,
    0
  );
  const wonValue = byStage("won").reduce((s, o) => s + o.value, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {opportunities.length} open deal{opportunities.length === 1 ? "" : "s"} · weighted
            pipeline ${Math.round(weighted).toLocaleString()} · won $
            {wonValue.toLocaleString()}
          </p>
        </div>
        <form action={createOpportunityAction} className="flex gap-2">
          <input
            name="name"
            required
            placeholder="Deal name"
            className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          />
          <input
            name="contactEmail"
            type="email"
            placeholder="contact@company.com"
            className="w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          />
          <input
            name="value"
            type="number"
            min={0}
            placeholder="$"
            className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"
          />
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500">
            Add deal
          </button>
        </form>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const deals = byStage(col.id);
          const total = deals.reduce((s, o) => s + o.value, 0);
          return (
            <div key={col.id} className="rounded-2xl bg-slate-100/70 p-3">
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-sm font-semibold text-slate-700">{col.label}</h2>
                <p className="text-xs tabular-nums text-slate-500">
                  {deals.length} · ${total.toLocaleString()}
                </p>
              </div>
              <div className="space-y-2.5">
                {deals.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">
                    No deals
                  </p>
                ) : (
                  deals.map((o) => <OpportunityCard key={o.id} opp={o} />)
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-slate-500">
        Deals are created automatically when a Unibox conversation is labeled
        Interested or beyond — set the value here as it firms up.
      </p>
    </div>
  );
}
