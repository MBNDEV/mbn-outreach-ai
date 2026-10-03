"use client";

import { useActionState } from "react";
import { inviteMemberAction, type InviteState } from "@/lib/actions/workspace";

export default function InviteForm() {
  const [state, formAction, pending] = useActionState(
    inviteMemberAction,
    {} as InviteState
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@company.com"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select name="role" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button
          disabled={pending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create invite"}
        </button>
      </div>
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.inviteUrl && (
        <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Invite created — send this link:{" "}
          <code className="break-all text-xs">{state.inviteUrl}</code>
        </div>
      )}
    </form>
  );
}
