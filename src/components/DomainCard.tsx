"use client";

import { useActionState, useState } from "react";
import {
  recheckDomainAction,
  connectMailboxAction,
  removeDomainAction,
} from "@/lib/actions/marketplace";
import type { FormState } from "@/lib/actions/auth";
import type { DnsRecord } from "@/lib/marketplace/dns";

const DOMAIN_STATUS: Record<string, { label: string; style: string }> = {
  pending: { label: "Setting up", style: "bg-slate-100 text-slate-600" },
  dns_pending: { label: "Waiting on DNS", style: "bg-amber-50 text-amber-800" },
  verified: { label: "Verified", style: "bg-green-50 text-green-700" },
  failed: { label: "Failed", style: "bg-red-50 text-red-700" },
};

const MAILBOX_STATUS: Record<string, { label: string; style: string }> = {
  pending: { label: "Queued", style: "bg-slate-100 text-slate-600" },
  awaiting_credentials: { label: "Needs credentials", style: "bg-amber-50 text-amber-800" },
  provisioning: { label: "Creating", style: "bg-indigo-50 text-indigo-700" },
  ready: { label: "Connected · warming", style: "bg-green-50 text-green-700" },
  failed: { label: "Failed", style: "bg-red-50 text-red-700" },
};

export default function DomainCard({
  domain,
  mailboxes,
  canManage,
}: {
  domain: {
    id: string;
    name: string;
    status: string;
    source: string;
    mailProvider: string;
    lastError: string;
    checkedAt: string | null;
    records: DnsRecord[];
  };
  mailboxes: Array<{
    id: string;
    email: string;
    status: string;
    lastError: string;
    accountId: string | null;
  }>;
  canManage: boolean;
}) {
  const [recheckState, recheck, rechecking] = useActionState(
    recheckDomainAction,
    {} as FormState
  );
  const [connectState, connect, connecting] = useActionState(
    connectMailboxAction,
    {} as FormState
  );
  const [openMailbox, setOpenMailbox] = useState<string | null>(null);
  const status = DOMAIN_STATUS[domain.status] ?? DOMAIN_STATUS.pending;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-sm font-semibold">{domain.name}</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.style}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {domain.source === "byo" ? "Your registration" : "Registered through us"} ·{" "}
            {domain.mailProvider}
            {domain.checkedAt ? ` · checked ${domain.checkedAt}` : ""}
          </p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <form action={recheck}>
              <input type="hidden" name="domainId" value={domain.id} />
              <button
                disabled={rechecking}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
              >
                {rechecking ? "Checking…" : "Check DNS"}
              </button>
            </form>
            <form action={removeDomainAction}>
              <input type="hidden" name="domainId" value={domain.id} />
              <button className="rounded-xl px-2 py-1.5 text-sm text-red-600 transition hover:bg-red-50">
                Remove
              </button>
            </form>
          </div>
        )}
      </div>

      {(recheckState.error || domain.lastError) && (
        <p className="border-b border-slate-100 bg-amber-50/60 px-5 py-2 text-sm text-amber-900">
          {recheckState.error || domain.lastError}
        </p>
      )}

      {domain.status !== "verified" && domain.records.length > 0 && (
        <div className="border-b border-slate-100 px-5 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            DNS records to add
          </h4>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Type</th>
                  <th className="py-1 pr-3">Host</th>
                  <th className="py-1 pr-3">Value</th>
                  <th className="py-1">Why</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {domain.records.map((record) => (
                  <tr key={`${record.type}-${record.host}`} className="border-t border-slate-50">
                    <td className="py-1.5 pr-3">
                      {record.type}
                      {record.priority !== undefined ? ` (${record.priority})` : ""}
                    </td>
                    <td className="py-1.5 pr-3">{record.host}</td>
                    <td className="max-w-xs break-all py-1.5 pr-3">{record.value}</td>
                    <td className="py-1.5 font-sans text-slate-500">
                      {record.purpose}
                      {record.required ? "" : " (optional)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ul className="divide-y divide-slate-50">
        {mailboxes.map((mailbox) => {
          const state = MAILBOX_STATUS[mailbox.status] ?? MAILBOX_STATUS.pending;
          const open = openMailbox === mailbox.id;
          return (
            <li key={mailbox.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{mailbox.email}</p>
                  {mailbox.lastError && (
                    <p className="text-xs text-red-600">{mailbox.lastError}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-lg px-2 py-0.5 text-xs ${state.style}`}>
                    {state.label}
                  </span>
                  {canManage && mailbox.status !== "ready" && domain.status === "verified" && (
                    <button
                      onClick={() => setOpenMailbox(open ? null : mailbox.id)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium transition hover:bg-slate-50"
                    >
                      {open ? "Cancel" : "Connect"}
                    </button>
                  )}
                </div>
              </div>

              {open && (
                <form action={connect} className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <input type="hidden" name="mailboxId" value={mailbox.id} />
                  <label className="col-span-2 text-xs text-slate-500">
                    Create this mailbox with your mail provider, then paste its SMTP and IMAP
                    details. We verify them before marking it ready.
                  </label>
                  <input
                    name="smtpHost"
                    placeholder="smtp.provider.com"
                    className="rounded-xl border border-slate-300 px-3 py-1.5"
                  />
                  <input
                    name="smtpPort"
                    type="number"
                    defaultValue={587}
                    className="rounded-xl border border-slate-300 px-3 py-1.5"
                  />
                  <input
                    name="imapHost"
                    placeholder="imap.provider.com"
                    className="rounded-xl border border-slate-300 px-3 py-1.5"
                  />
                  <input
                    name="imapPort"
                    type="number"
                    defaultValue={993}
                    className="rounded-xl border border-slate-300 px-3 py-1.5"
                  />
                  <input
                    name="username"
                    placeholder={mailbox.email}
                    className="rounded-xl border border-slate-300 px-3 py-1.5"
                  />
                  <input
                    name="password"
                    type="password"
                    placeholder="App password"
                    className="rounded-xl border border-slate-300 px-3 py-1.5"
                  />
                  <button
                    disabled={connecting}
                    className="col-span-2 rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {connecting ? "Verifying…" : "Connect and start warming"}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {connectState.error && (
        <p className="border-t border-slate-100 px-5 py-2 text-sm text-red-600">
          {connectState.error}
        </p>
      )}
    </div>
  );
}
