"use client";

import { useActionState } from "react";
import {
  createApiKeyAction,
  addWebhookAction,
  type ApiKeyState,
} from "@/lib/actions/integrations";
import type { FormState } from "@/lib/actions/auth";

const EVENTS = [
  { id: "reply_received", label: "Reply received" },
  { id: "bounce_received", label: "Bounce received" },
  { id: "lead_unsubscribed", label: "Lead unsubscribed" },
  { id: "campaign_completed", label: "Campaign completed" },
];

export function ApiKeyCreator() {
  const [state, formAction, pending] = useActionState(
    createApiKeyAction,
    {} as ApiKeyState
  );
  return (
    <div className="space-y-3">
      <form action={formAction} className="flex gap-3">
        <input
          name="name"
          placeholder="Key name (e.g. Zapier)"
          className="w-56 rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
        />
        <button
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      {state.plainKey && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Copy this key now — it won&apos;t be shown again:{" "}
          <code className="break-all text-xs font-semibold">{state.plainKey}</code>
        </div>
      )}
    </div>
  );
}

export function WebhookCreator() {
  const [state, formAction, pending] = useActionState(
    addWebhookAction,
    {} as FormState
  );
  return (
    <form action={formAction} className="space-y-3">
      <input
        name="url"
        placeholder="https://example.com/webhooks/outreach"
        className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
      />
      <div className="flex flex-wrap gap-3">
        {EVENTS.map((e) => (
          <label key={e.id} className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name={e.id}
              defaultChecked={e.id === "reply_received"}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            {e.label}
          </label>
        ))}
      </div>
      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add webhook"}
      </button>
    </form>
  );
}
