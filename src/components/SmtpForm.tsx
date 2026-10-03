"use client";

import { useActionState } from "react";
import { addSmtpAccountAction } from "@/lib/actions/accounts";
import type { FormState } from "@/lib/actions/auth";

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500";

export default function SmtpForm() {
  const [state, formAction, pending] = useActionState(
    addSmtpAccountAction,
    {} as FormState
  );

  return (
    <form action={formAction} className="max-w-xl space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Sender first name</span>
          <input name="firstName" className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Sender last name</span>
          <input name="lastName" className={inputCls} />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email address</span>
        <input name="email" type="email" required className={inputCls} />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Username (if different)</span>
          <input name="username" placeholder="defaults to email" className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Password / app password</span>
          <input name="password" type="password" required className={inputCls} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">SMTP host</span>
          <input name="smtpHost" placeholder="smtp.example.com" required className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">SMTP port</span>
          <input name="smtpPort" type="number" defaultValue={587} className={inputCls} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">IMAP host</span>
          <input name="imapHost" placeholder="imap.example.com" required className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">IMAP port</span>
          <input name="imapPort" type="number" defaultValue={993} className={inputCls} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Daily sending limit</span>
          <input name="dailyLimit" type="number" defaultValue={30} className={inputCls} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Tags (comma-separated)</span>
          <input name="tags" placeholder="clientA, primary" className={inputCls} />
        </label>
      </div>
      {state.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Connecting & testing…" : "Connect account"}
      </button>
      <p className="text-xs text-slate-500">
        Credentials are encrypted at rest. On connect we verify both SMTP and
        IMAP logins; the account shows as Connected only when both pass.
      </p>
    </form>
  );
}
