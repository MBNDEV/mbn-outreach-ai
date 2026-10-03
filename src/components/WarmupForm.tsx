"use client";

import { useState } from "react";
import { saveWarmupAction } from "@/lib/actions/deliverability";

export default function WarmupForm({
  account,
}: {
  account: {
    id: string;
    warmupEnabled: boolean;
    warmupPoolOptIn: boolean;
    warmupTarget: number;
  };
}) {
  const [enabled, setEnabled] = useState(account.warmupEnabled);

  return (
    <form action={saveWarmupAction} className="mt-5 space-y-4 border-t border-slate-100 pt-4">
      <input type="hidden" name="id" value={account.id} />

      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          name="warmupEnabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
        />
        <span className="font-medium">Warm this mailbox up</span>
      </label>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="warmupPoolOptIn"
          defaultChecked={account.warmupPoolOptIn}
          disabled={!enabled}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 disabled:opacity-40"
        />
        <span className={enabled ? "" : "text-slate-400"}>
          <span className="font-medium">Join the shared pool</span>
          <span className="block text-slate-500">
            Pairs with opted-in mailboxes in other workspaces. Traffic that never leaves your own
            domains teaches a provider very little, so the shared pool warms faster.
          </span>
        </span>
      </label>

      <label className="block text-sm">
        <span className={`font-medium ${enabled ? "" : "text-slate-400"}`}>
          Daily ceiling once ramped
        </span>
        <input
          type="number"
          name="warmupTarget"
          min={2}
          max={200}
          defaultValue={account.warmupTarget}
          disabled={!enabled}
          className="mt-1 w-28 rounded-xl border border-slate-300 px-3 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        />
        <span className="ml-2 text-slate-500">
          starts at 2/day and climbs by 2 each day
        </span>
      </label>

      <button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
        Save warmup settings
      </button>
    </form>
  );
}
