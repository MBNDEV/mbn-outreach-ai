"use client";

import { useState } from "react";
import { saveAgentAction } from "@/lib/actions/agents";

export default function AgentSettingsForm({
  agent,
}: {
  agent: {
    id: string;
    name: string;
    icp: string;
    dailyLeadTarget: number;
    autoApprove: boolean;
  };
}) {
  const [autoApprove, setAutoApprove] = useState(agent.autoApprove);

  return (
    <form
      action={saveAgentAction}
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <input type="hidden" name="id" value={agent.id} />
      <h2 className="text-sm font-semibold">Settings</h2>

      <label className="block text-sm">
        <span className="font-medium">Name</span>
        <input
          name="name"
          defaultValue={agent.name}
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
        />
      </label>

      <label className="block text-sm">
        <span className="font-medium">Who to prefer</span>
        <textarea
          name="icp"
          rows={2}
          defaultValue={agent.icp}
          placeholder="Owners of home-service businesses in Arizona"
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="mt-1 block text-xs text-slate-500">
          Added to the workspace ideal-customer memory when copy is generated.
        </span>
      </label>

      <label className="block text-sm">
        <span className="font-medium">Leads per day</span>
        <input
          type="number"
          name="dailyLeadTarget"
          min={1}
          max={200}
          defaultValue={agent.dailyLeadTarget}
          className="mt-1 w-24 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
        />
      </label>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          name="autoApprove"
          checked={autoApprove}
          onChange={(e) => setAutoApprove(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
        />
        <span>
          <span className="font-medium">Skip my approval</span>
          <span className="block text-slate-500">
            Queues leads straight into the campaign. Leave this off until you trust what the
            agent is picking — approved leads get real email.
          </span>
        </span>
      </label>

      {autoApprove && !agent.autoApprove && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          With this saved, the agent mails people without asking you first.
        </p>
      )}

      <button className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
        Save settings
      </button>
    </form>
  );
}
