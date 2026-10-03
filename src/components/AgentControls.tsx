"use client";

import { useActionState } from "react";
import {
  setAgentStatusAction,
  deleteAgentAction,
  runAgentNowAction,
} from "@/lib/actions/agents";
import type { FormState } from "@/lib/actions/auth";

export default function AgentControls({
  agentId,
  status,
}: {
  agentId: string;
  status: string;
}) {
  const [runState, runNow, running] = useActionState(runAgentNowAction, {} as FormState);
  const active = status === "active";

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <form action={runNow}>
          <input type="hidden" name="id" value={agentId} />
          <button
            disabled={running}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
          >
            {running ? "Working…" : "Run now"}
          </button>
        </form>
        <form action={setAgentStatusAction}>
          <input type="hidden" name="id" value={agentId} />
          <button
            className={`rounded-xl px-3 py-1.5 text-sm font-semibold shadow-sm transition ${
              active
                ? "border border-slate-300 hover:bg-slate-50"
                : "bg-indigo-600 text-white hover:bg-indigo-700"
            }`}
          >
            {active ? "Pause" : "Resume"}
          </button>
        </form>
        <form action={deleteAgentAction}>
          <input type="hidden" name="id" value={agentId} />
          <button className="rounded-xl px-2 py-1.5 text-sm text-red-600 transition hover:bg-red-50">
            Delete
          </button>
        </form>
      </div>
      {runState.error && <p className="text-xs text-slate-500">{runState.error}</p>}
    </div>
  );
}
