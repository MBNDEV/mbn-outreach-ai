"use client";

import { useActionState } from "react";
import { importCsvAction, type CsvImportState } from "@/lib/actions/accounts";

export default function CsvImportForm() {
  const [state, formAction, pending] = useActionState(
    importCsvAction,
    {} as CsvImportState
  );

  return (
    <div className="max-w-xl space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
        <p className="font-medium">Expected columns</p>
        <code className="mt-2 block overflow-x-auto rounded bg-slate-50 p-2 text-xs">
          email,password,smtp_host,smtp_port,imap_host,imap_port,first_name,last_name,daily_limit,tags
        </code>
        <p className="mt-2 text-xs text-slate-500">
          smtp_port defaults to 587, imap_port to 993, daily_limit to 30. Tags
          are comma-separated inside the cell. Every row is health-checked on
          import.
        </p>
      </div>
      <form action={formAction} className="space-y-4">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500"
        />
        {state.error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}
        {state.imported !== undefined && (
          <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            Imported {state.imported} account{state.imported === 1 ? "" : "s"}.
            {state.skipped && state.skipped.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
                {state.skipped.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? "Importing & testing…" : "Import accounts"}
        </button>
      </form>
    </div>
  );
}
