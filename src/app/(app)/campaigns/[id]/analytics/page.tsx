import { db } from "@/lib/db";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default async function CampaignAnalyticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [messages, replies, steps, leadCounts] = await Promise.all([
    db.message.findMany({
      where: { campaignId: id, direction: "out" },
      select: { stepId: true, variantId: true, openCount: true, clickCount: true, openedAt: true },
    }),
    db.message.count({ where: { campaignId: id, direction: "in", kind: "reply" } }),
    db.sequenceStep.findMany({
      where: { campaignId: id },
      orderBy: { order: "asc" },
      include: { variants: true },
    }),
    db.campaignLead.groupBy({
      by: ["status"],
      where: { campaignId: id },
      _count: true,
    }),
  ]);

  const sent = messages.length;
  const opened = messages.filter((m) => m.openedAt).length;
  const clicks = messages.reduce((sum, m) => sum + m.clickCount, 0);
  const statusOf = (s: string) => leadCounts.find((l) => l.status === s)?._count ?? 0;
  const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-5 gap-4">
        <Stat label="Emails sent" value={String(sent)} />
        <Stat label="Open rate" value={pct(opened, sent)} sub={`${opened} unique opens`} />
        <Stat
          label="Reply rate"
          value={pct(Math.min(replies, statusOf("replied")) || replies, sent)}
          sub={`${replies} replies · ${statusOf("bounced")} bounced`}
        />
        <Stat label="Clicks" value={String(clicks)} />
        <Stat
          label="Finished sequence"
          value={String(statusOf("completed"))}
          sub={`${statusOf("unsubscribed")} unsubscribed`}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold">Step performance</h2>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-100 bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">Step</th>
              <th className="px-5 py-3">Variant</th>
              <th className="px-5 py-3">Sent</th>
              <th className="px-5 py-3">Opened</th>
              <th className="px-5 py-3">Open rate</th>
              <th className="px-5 py-3">Clicks</th>
            </tr>
          </thead>
          <tbody>
            {steps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                  No sequence steps yet.
                </td>
              </tr>
            )}
            {steps.flatMap((step, si) =>
              step.variants.map((variant) => {
                const rows = messages.filter((m) => m.variantId === variant.id);
                const vOpened = rows.filter((m) => m.openedAt).length;
                const vClicks = rows.reduce((s, m) => s + m.clickCount, 0);
                return (
                  <tr key={variant.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 font-medium">Step {si + 1}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-xs font-semibold text-indigo-700">
                        {variant.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 tabular-nums">{rows.length}</td>
                    <td className="px-5 py-3 tabular-nums">{vOpened}</td>
                    <td className="px-5 py-3 tabular-nums">{pct(vOpened, rows.length)}</td>
                    <td className="px-5 py-3 tabular-nums">{vClicks}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
