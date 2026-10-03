"use client";

import { useActionState } from "react";
import {
  importWorkspaceLeadsAction,
  verifyLeadsAction,
  pushToCampaignAction,
  type LeadsOpState,
} from "@/lib/actions/leads";

function OpResult({ state }: { state: LeadsOpState }) {
  if (state.error)
    return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>;
  if (state.message)
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>
    );
  return null;
}

export function ImportPanel({
  lists,
}: {
  lists: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(
    importWorkspaceLeadsAction,
    {} as LeadsOpState
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input
        type="file"
        name="file"
        accept=".csv,text/csv"
        required
        className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
      />
      <select name="listId" className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm">
        <option value="">No list</option>
        {lists.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <button
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Importing…" : "Import CSV"}
      </button>
      <OpResult state={state} />
    </form>
  );
}

export function BulkActions({
  q,
  listId,
  campaigns,
}: {
  q?: string;
  listId?: string;
  campaigns: { id: string; name: string }[];
}) {
  const [verifyState, verifyAction, verifying] = useActionState(
    verifyLeadsAction,
    {} as LeadsOpState
  );
  const [pushState, pushAction, pushing] = useActionState(
    pushToCampaignAction,
    {} as LeadsOpState
  );
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={verifyAction} className="flex items-center gap-2">
        <input type="hidden" name="q" value={q ?? ""} />
        <input type="hidden" name="listId" value={listId ?? ""} />
        <button
          disabled={verifying}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
        >
          {verifying ? "Verifying…" : "Verify emails (1 credit each)"}
        </button>
      </form>
      <form action={pushAction} className="flex items-center gap-2">
        <input type="hidden" name="q" value={q ?? ""} />
        <input type="hidden" name="listId" value={listId ?? ""} />
        <select
          name="campaignId"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
        >
          <option value="">Choose campaign…</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          disabled={pushing}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {pushing ? "Adding…" : "Push to campaign"}
        </button>
      </form>
      <OpResult state={verifyState} />
      <OpResult state={pushState} />
    </div>
  );
}
