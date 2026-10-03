"use client";

import { useActionState, useState } from "react";
import {
  importLeadsCsvAction,
  addLeadsManualAction,
  type LeadImportState,
} from "@/lib/actions/campaigns";

function Result({ state }: { state: LeadImportState }) {
  if (state.error)
    return (
      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
    );
  if (state.imported !== undefined)
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        Added {state.imported} lead{state.imported === 1 ? "" : "s"}
        {state.skipped ? `, skipped ${state.skipped} (invalid or already in campaign)` : ""}.
      </p>
    );
  return null;
}

export default function LeadImport({ campaignId }: { campaignId: string }) {
  const [mode, setMode] = useState<"csv" | "manual">("csv");
  const [csvState, csvAction, csvPending] = useActionState(
    importLeadsCsvAction,
    {} as LeadImportState
  );
  const [manualState, manualAction, manualPending] = useActionState(
    addLeadsManualAction,
    {} as LeadImportState
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex gap-1">
        {(["csv", "manual"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === m ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
            }`}
          >
            {m === "csv" ? "Upload CSV" : "Paste emails"}
          </button>
        ))}
      </div>

      {mode === "csv" ? (
        <form action={csvAction} className="space-y-3">
          <input type="hidden" name="campaignId" value={campaignId} />
          <p className="text-xs text-slate-500">
            Columns: <code className="rounded bg-slate-100 px-1 py-0.5">email</code> (required),{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">first_name</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">last_name</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">company</code>,{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">title</code> — extra columns become
            custom variables.
          </p>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
          />
          <Result state={csvState} />
          <button
            disabled={csvPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {csvPending ? "Importing…" : "Import leads"}
          </button>
        </form>
      ) : (
        <form action={manualAction} className="space-y-3">
          <input type="hidden" name="campaignId" value={campaignId} />
          <textarea
            name="emails"
            rows={5}
            placeholder={"jane@acme.com\njohn@globex.com"}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          />
          <Result state={manualState} />
          <button
            disabled={manualPending}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            {manualPending ? "Adding…" : "Add leads"}
          </button>
        </form>
      )}
    </div>
  );
}
