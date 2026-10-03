import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { searchProvider } from "@/lib/leadsearch";
import { parseFilter } from "@/lib/leadfilter";
import LeadSearchPanel from "@/components/LeadSearchPanel";

export default async function LeadSearchPage() {
  const { workspace } = await requireWorkspace();
  const [saved, lists] = await Promise.all([
    db.savedSearch.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    }),
    db.leadList.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead search</h1>
          <p className="mt-1 text-sm text-slate-500">
            {workspace.credits.toLocaleString()} credits · searching is free, importing costs one
            credit per new lead.
          </p>
        </div>
        <Link
          href="/leads"
          className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50"
        >
          Leads database
        </Link>
      </div>

      <LeadSearchPanel
        provider={searchProvider()}
        savedSearches={saved.map((search) => ({
          id: search.id,
          name: search.name,
          filter: parseFilter(search.filter),
        }))}
        listNames={lists.map((list) => list.name)}
      />
    </div>
  );
}
