import { db } from "@/lib/db";
import LeadImport from "@/components/LeadImport";
import StatusPill from "@/components/StatusPill";
import { removeCampaignLeadAction } from "@/lib/actions/campaigns";

export default async function CampaignLeadsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const leads = await db.campaignLead.findMany({
    where: { campaignId: id },
    include: { lead: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return (
    <div className="space-y-6">
      <LeadImport campaignId={id} />

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          No leads yet — import a CSV or paste emails above.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Email</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Step</th>
                <th className="px-5 py-3">Next send</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {leads.map((cl) => (
                <tr key={cl.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-medium text-slate-900">{cl.lead.email}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {[cl.lead.firstName, cl.lead.lastName].filter(Boolean).join(" ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-slate-600">{cl.lead.company || "—"}</td>
                  <td className="px-5 py-3">
                    <StatusPill status={cl.status} title={cl.statusNote} />
                  </td>
                  <td className="px-5 py-3 tabular-nums text-slate-600">{cl.currentStep}</td>
                  <td className="px-5 py-3 text-xs text-slate-500">
                    {cl.nextSendAt ? cl.nextSendAt.toLocaleString() : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <form action={removeCampaignLeadAction}>
                      <input type="hidden" name="campaignId" value={id} />
                      <input type="hidden" name="id" value={cl.id} />
                      <button className="text-xs font-medium text-red-600 hover:text-red-800">
                        Remove
                      </button>
                    </form>
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
