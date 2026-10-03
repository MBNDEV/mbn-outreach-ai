import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import SnippetBox from "@/components/SnippetBox";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname + (parsed.search ? "?…" : "");
  } catch {
    return url;
  }
}

export default async function VisitorsPage() {
  const { workspace } = await requireWorkspace();

  const [events, identified, visitorCount] = await Promise.all([
    db.visitorEvent.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { lead: { select: { id: true, email: true, firstName: true, company: true } } },
    }),
    db.visitorEvent.count({ where: { workspaceId: workspace.id, leadId: { not: null } } }),
    db.visitorEvent
      .findMany({
        where: { workspaceId: workspace.id },
        distinct: ["visitorId"],
        select: { visitorId: true },
      })
      .then((rows) => rows.length),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Website visitors</h1>
        <p className="mt-1 text-sm text-slate-500">
          Who lands on your site after a campaign click. Visitors who arrive through a tracked link
          are tied to the lead who clicked it, on that visit and every later one from that browser.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Page views</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{events.length === 100 ? "100+" : events.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Unique visitors</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{visitorCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Identified as leads</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{identified}</p>
        </div>
      </div>

      <SnippetBox workspaceId={workspace.id} />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold">Recent visits</h2>
        </div>
        {events.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">
            No visits recorded yet. Install the snippet above, then click a tracked link in one of
            your own campaign emails to see attribution work end to end.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Who</th>
                <th className="px-5 py-3">Page</th>
                <th className="px-5 py-3">Referrer</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-2.5 text-slate-500">
                    {event.createdAt.toLocaleString()}
                  </td>
                  <td className="px-5 py-2.5">
                    {event.lead ? (
                      <Link
                        href={`/leads?q=${encodeURIComponent(event.lead.email)}`}
                        className="font-medium text-indigo-700 hover:underline"
                      >
                        {event.lead.firstName || event.lead.email}
                        {event.lead.company && (
                          <span className="font-normal text-slate-500"> · {event.lead.company}</span>
                        )}
                      </Link>
                    ) : (
                      <span className="text-slate-400">anonymous · {event.visitorId.slice(0, 8)}</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <span className="text-slate-900">{pathOf(event.url)}</span>
                    <span className="block text-xs text-slate-400">{hostOf(event.url)}</span>
                  </td>
                  <td className="px-5 py-2.5 text-slate-500">
                    {event.referrer ? hostOf(event.referrer) : "direct"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
