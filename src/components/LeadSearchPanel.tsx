"use client";

import { useActionState, useState } from "react";
import {
  searchLeadsAction,
  importFoundLeadsAction,
  saveSearchAction,
  deleteSearchAction,
  draftFilterAction,
  type SearchState,
  type AiFilterState,
} from "@/lib/actions/leadsearch";
import {
  SENIORITIES,
  COMPANY_SIZES,
  emptyFilter,
  type LeadFilter,
} from "@/lib/leadfilter";

export default function LeadSearchPanel({
  provider,
  savedSearches,
  listNames,
}: {
  provider: string | null;
  savedSearches: Array<{ id: string; name: string; filter: LeadFilter }>;
  listNames: string[];
}) {
  const [searchState, runSearch, searching] = useActionState(searchLeadsAction, {} as SearchState);
  const [importState, runImport, importing] = useActionState(
    importFoundLeadsAction,
    {} as SearchState
  );
  const [aiState, draftFilter, drafting] = useActionState(draftFilterAction, {} as AiFilterState);
  const [loaded, setLoaded] = useState<LeadFilter | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // An AI draft supersedes a saved search that was loaded earlier.
  const filter = aiState.filter ?? loaded ?? emptyFilter();

  const leads = searchState.leads ?? [];
  // Keyed by provider id, not address: search results carry no address until
  // import reveals it.
  const selectedLeads = leads.filter((lead) => selected[lead.providerId] && lead.emailAvailable);

  return (
    <div className="space-y-6">
      {!provider && (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          No data partner configured. Set <code className="font-mono text-xs">APOLLO_API_KEY</code>{" "}
          in <code className="font-mono text-xs">.env</code> to search live data — the filters below
          are the product&rsquo;s own shape, so swapping providers later changes nothing here.
        </p>
      )}

      <form action={draftFilter} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm">
          <span className="font-medium">Describe your ideal customer</span>
          <span className="mt-0.5 block text-slate-500">
            Plain English. Claude turns it into the filters below, which you can then adjust.
          </span>
          <textarea
            name="request"
            rows={2}
            placeholder="Owners of family-run plumbing companies around Phoenix, 10 to 50 staff"
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <div className="mt-3 flex items-center gap-3">
          <button
            disabled={drafting}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
          >
            {drafting ? "Thinking…" : "Build filters"}
          </button>
          {aiState.filter && (
            <p className="text-sm text-green-700">Filters updated below — review before searching.</p>
          )}
        </div>
        {aiState.error && <p className="mt-2 text-sm text-red-600">{aiState.error}</p>}
      </form>

      <form
        // The inputs are uncontrolled: defaultValue is ignored once an input
        // exists, so a new filter has to remount the form to show up.
        key={JSON.stringify(filter)}
        action={runSearch}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="font-medium">Job titles</span>
            <input
              name="titles"
              defaultValue={filter.titles.join(", ")}
              placeholder="owner, marketing director"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
            />
            <span className="mt-1 block text-xs text-slate-500">Comma separated.</span>
          </label>
          <label className="text-sm">
            <span className="font-medium">Locations</span>
            <input
              name="locations"
              defaultValue={filter.locations.join(", ")}
              placeholder="Phoenix, Arizona"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">Industry keywords</span>
            <input
              name="industries"
              defaultValue={filter.industries.join(", ")}
              placeholder="plumbing, hvac, roofing"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="font-medium">Free text</span>
            <input
              name="keywords"
              defaultValue={filter.keywords}
              placeholder="family owned"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Seniority</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {SENIORITIES.map((level) => (
              <label key={level} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="seniorities"
                  value={level}
                  defaultChecked={filter.seniorities.includes(level)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                <span className="capitalize">{level.replace("_", " ")}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Company size</legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {COMPANY_SIZES.map((size) => (
              <label key={size.value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="companySizes"
                  value={size.value}
                  defaultChecked={filter.companySizes.includes(size.value)}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                <span>{size.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex items-center gap-3">
          <button
            disabled={searching}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search"}
          </button>
          {searchState.total !== undefined && (
            <p className="text-sm text-slate-600">
              {searchState.total.toLocaleString()} matches · showing {leads.length}
            </p>
          )}
        </div>
        {searchState.error && <p className="mt-3 text-sm text-red-600">{searchState.error}</p>}
      </form>

      {searchState.filter && (
        <form action={saveSearchAction} className="flex items-end gap-2">
          <input type="hidden" name="filter" value={JSON.stringify(searchState.filter)} />
          <label className="text-sm">
            <span className="font-medium">Save this search</span>
            <input
              name="name"
              placeholder="Phoenix plumbing owners"
              className="mt-1 block w-64 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <button className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50">
            Save
          </button>
        </form>
      )}

      {savedSearches.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Saved searches</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {savedSearches.map((search) => (
              <li key={search.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-medium">{search.name}</p>
                  <p className="text-xs text-slate-500">
                    {[
                      search.filter.titles.join(", "),
                      search.filter.locations.join(", "),
                      search.filter.industries.join(", "),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "no filters"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLoaded(search.filter)}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium transition hover:bg-slate-50"
                  >
                    Load
                  </button>
                  <form action={deleteSearchAction}>
                    <input type="hidden" name="id" value={search.id} />
                    <button className="text-xs text-red-600 underline hover:text-red-800">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {leads.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">Results</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Surnames are masked and addresses withheld until you import — browsing is free, and
                only the rows you pick cost a credit.
              </p>
            </div>
            <form action={runImport} className="flex items-end gap-2">
              <input type="hidden" name="leads" value={JSON.stringify(selectedLeads)} />
              <label className="text-sm">
                <span className="text-xs font-medium text-slate-600">Add to list (optional)</span>
                <input
                  name="listName"
                  list="lead-lists"
                  placeholder="New or existing list"
                  className="mt-1 block w-52 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                />
                <datalist id="lead-lists">
                  {listNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <button
                disabled={importing || selectedLeads.length === 0}
                className="rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {importing ? "Importing…" : `Import ${selectedLeads.length || ""}`.trim()}
              </button>
            </form>
          </div>

          {(importState.error || importState.message) && (
            <p
              className={`px-5 py-2 text-sm ${
                importState.error ? "text-red-600" : "text-green-700"
              }`}
            >
              {importState.error ?? importState.message}
            </p>
          )}

          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3" />
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Title</th>
                <th className="px-5 py-3">Company</th>
                <th className="px-5 py-3">Email</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead, index) => (
                <tr
                  key={lead.providerId || `${lead.firstName}-${lead.company}-${index}`}
                  className="border-b border-slate-50 last:border-0"
                >
                  <td className="px-5 py-2.5">
                    <input
                      type="checkbox"
                      disabled={!lead.emailAvailable}
                      checked={Boolean(selected[lead.providerId])}
                      onChange={(e) =>
                        setSelected((prev) => ({ ...prev, [lead.providerId]: e.target.checked }))
                      }
                      className="h-4 w-4 rounded border-slate-300 text-indigo-600 disabled:opacity-30"
                    />
                  </td>
                  <td className="px-5 py-2.5 font-medium">
                    {lead.firstName} {lead.lastName}
                  </td>
                  <td className="px-5 py-2.5 text-slate-600">{lead.title}</td>
                  <td className="px-5 py-2.5 text-slate-600">{lead.company}</td>
                  <td className="px-5 py-2.5">
                    {lead.email ? (
                      lead.email
                    ) : lead.emailAvailable ? (
                      <span className="text-xs text-slate-500">revealed on import</span>
                    ) : (
                      <span className="text-xs text-slate-400">no address on file</span>
                    )}
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
