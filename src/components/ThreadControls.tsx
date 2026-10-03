"use client";

import { useRef } from "react";
import { useActionState } from "react";
import {
  setThreadLabelAction,
  setThreadDoneAction,
  setThreadReminderAction,
  sendReplyAction,
} from "@/lib/actions/unibox";
import { THREAD_LABELS } from "@/lib/labels";
import type { FormState } from "@/lib/actions/auth";

export function LabelPicker({
  threadId,
  label,
}: {
  threadId: string;
  label: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={setThreadLabelAction}>
      <input type="hidden" name="threadId" value={threadId} />
      <select
        name="label"
        defaultValue={label}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium shadow-sm"
      >
        <option value="">No label</option>
        {THREAD_LABELS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </form>
  );
}

export function DoneToggle({ threadId, done }: { threadId: string; done: boolean }) {
  return (
    <form action={setThreadDoneAction}>
      <input type="hidden" name="threadId" value={threadId} />
      <input type="hidden" name="done" value={done ? "false" : "true"} />
      <button
        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
          done
            ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
            : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        }`}
      >
        {done ? "Reopen" : "Mark done"}
      </button>
    </form>
  );
}

export function ReminderPicker({
  threadId,
  reminderAt,
}: {
  threadId: string;
  reminderAt: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={setThreadReminderAction} className="flex items-center gap-1.5">
      <input type="hidden" name="threadId" value={threadId} />
      <input
        type="datetime-local"
        name="reminderAt"
        defaultValue={reminderAt ?? ""}
        onChange={() => formRef.current?.requestSubmit()}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs shadow-sm"
        aria-label="Reminder"
      />
    </form>
  );
}

export function ReplyComposer({ threadId }: { threadId: string }) {
  const [state, formAction, pending] = useActionState(sendReplyAction, {} as FormState);
  return (
    <form action={formAction} className="border-t border-slate-100 p-4">
      <input type="hidden" name="threadId" value={threadId} />
      <textarea
        name="body"
        rows={4}
        placeholder="Write a reply…"
        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
      {state.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <div className="mt-2 flex justify-end">
        <button
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send reply"}
        </button>
      </div>
    </form>
  );
}
