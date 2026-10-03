"use client";

import { useRef } from "react";
import { updateOpportunityAction, deleteOpportunityAction } from "@/lib/actions/crm";
import { IconTrash } from "@/components/icons";

const STAGES = [
  { id: "interested", label: "Interested" },
  { id: "meeting_booked", label: "Meeting booked" },
  { id: "meeting_completed", label: "Meeting completed" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export default function OpportunityCard({
  opp,
}: {
  opp: { id: string; name: string; contactEmail: string; value: number; stage: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{opp.name}</p>
          {opp.contactEmail && (
            <p className="truncate text-xs text-slate-500">{opp.contactEmail}</p>
          )}
        </div>
        <form action={deleteOpportunityAction}>
          <input type="hidden" name="id" value={opp.id} />
          <button
            aria-label="Delete opportunity"
            className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        </form>
      </div>
      <form ref={formRef} action={updateOpportunityAction} className="mt-2.5 flex items-center gap-2">
        <input type="hidden" name="id" value={opp.id} />
        <div className="flex items-center rounded-lg border border-slate-200 bg-white shadow-sm">
          <span className="pl-2 text-xs text-slate-400">$</span>
          <input
            name="value"
            type="number"
            min={0}
            defaultValue={opp.value}
            onBlur={() => formRef.current?.requestSubmit()}
            className="w-20 rounded-lg px-1.5 py-1 text-xs tabular-nums outline-none"
            aria-label="Deal value"
          />
        </div>
        <select
          name="stage"
          defaultValue={opp.stage}
          onChange={() => formRef.current?.requestSubmit()}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm"
          aria-label="Stage"
        >
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </form>
    </div>
  );
}
