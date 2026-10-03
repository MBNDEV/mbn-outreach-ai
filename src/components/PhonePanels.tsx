"use client";

import { useActionState } from "react";
import {
  addNumberAction,
  importNumbersAction,
  saveLeadPhoneAction,
  sendTestSmsAction,
  checkLeadTextableAction,
  logCallAction,
  clickToCallAction,
  type LeadSmsState,
} from "@/lib/actions/phone";
import type { FormState } from "@/lib/actions/auth";

export default function PhonePanels({
  canManage,
  configured,
  outcomes,
  hasNumbers,
}: {
  canManage: boolean;
  configured: boolean;
  outcomes: string[];
  hasNumbers: boolean;
}) {
  const [addState, addNumber, adding] = useActionState(addNumberAction, {} as FormState);
  const [importState, importNumbers, importing] = useActionState(
    importNumbersAction,
    {} as FormState
  );
  const [consentState, saveConsent, savingConsent] = useActionState(
    saveLeadPhoneAction,
    {} as LeadSmsState
  );
  const [checkState, check, checking] = useActionState(
    checkLeadTextableAction,
    {} as LeadSmsState
  );
  const [smsState, sendSms, sendingSms] = useActionState(sendTestSmsAction, {} as LeadSmsState);
  const [callState, logCall, logging] = useActionState(logCallAction, {} as FormState);
  const [dialState, dial, dialing] = useActionState(clickToCallAction, {} as FormState);

  if (!canManage) {
    return (
      <p className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500">
        Ask an admin to add numbers or send texts.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">Add a sending number</h2>
          <form action={addNumber} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="font-medium">Number</span>
              <input
                name="number"
                placeholder="+14805550123"
                className="mt-1 block w-40 rounded-xl border border-slate-300 px-3 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Label</span>
              <input
                name="label"
                placeholder="Sales line"
                className="mt-1 block w-32 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Texts/day</span>
              <input
                type="number"
                name="dailySmsLimit"
                defaultValue={50}
                min={1}
                max={500}
                className="mt-1 block w-24 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <button
              disabled={adding}
              className="rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {adding ? "Adding…" : "Add"}
            </button>
          </form>
          {addState.error && <p className="mt-2 text-sm text-red-600">{addState.error}</p>}

          <form action={importNumbers} className="mt-3">
            <button
              disabled={importing || !configured}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-50"
            >
              {importing ? "Importing…" : "Import from Twilio"}
            </button>
          </form>
          {importState.error && <p className="mt-2 text-sm text-amber-700">{importState.error}</p>}
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold">Lead phone &amp; consent</h2>
          <p className="mt-1 text-sm text-slate-600">
            A lead is only textable with a number and consent on file. An earlier STOP always wins.
          </p>
          <form action={saveConsent} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="font-medium">Lead email</span>
              <input
                name="email"
                placeholder="jane@acmeplumbing.com"
                className="mt-1 block w-56 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Phone</span>
              <input
                name="phone"
                placeholder="+14805550123"
                className="mt-1 block w-40 rounded-xl border border-slate-300 px-3 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Consent</span>
              <select
                name="consent"
                className="mt-1 block rounded-xl border border-slate-300 px-2 py-1.5 text-sm"
              >
                <option value="">none</option>
                <option value="explicit">explicit</option>
                <option value="implied">implied</option>
              </select>
            </label>
            <button
              disabled={savingConsent}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
            >
              Save
            </button>
          </form>
          {consentState.error && <p className="mt-2 text-sm text-red-600">{consentState.error}</p>}
          {consentState.message && (
            <p className="mt-2 text-sm text-green-700">{consentState.message}</p>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold">Send a text</h2>
          <form action={check} className="mt-3 flex items-end gap-2">
            <label className="flex-1 text-sm">
              <span className="font-medium">Lead email</span>
              <input
                name="email"
                placeholder="jane@acmeplumbing.com"
                className="mt-1 block w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <button
              disabled={checking}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
            >
              {checking ? "Checking…" : "Can I text?"}
            </button>
          </form>
          {checkState.error && <p className="mt-2 text-sm text-amber-700">{checkState.error}</p>}
          {checkState.message && (
            <p className="mt-2 text-sm text-green-700">{checkState.message}</p>
          )}

          <form action={sendSms} className="mt-3 space-y-2">
            <input
              name="email"
              placeholder="jane@acmeplumbing.com"
              className="w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
            />
            <textarea
              name="body"
              rows={2}
              placeholder="Hi Jane — following up on the site audit. Worth a quick call?"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              disabled={sendingSms || !configured || !hasNumbers}
              className="rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {sendingSms ? "Sending…" : "Send text"}
            </button>
          </form>
          {smsState.error && <p className="mt-2 text-sm text-red-600">{smsState.error}</p>}
          {smsState.message && <p className="mt-2 text-sm text-green-700">{smsState.message}</p>}
        </div>

        <div className="border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold">Calls</h2>
          <form action={dial} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="font-medium">Lead email</span>
              <input
                name="email"
                className="mt-1 block w-48 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Ring me on</span>
              <input
                name="repNumber"
                placeholder="+14805550999"
                className="mt-1 block w-40 rounded-xl border border-slate-300 px-3 py-1.5 font-mono text-sm"
              />
            </label>
            <button
              disabled={dialing || !configured}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-50"
            >
              {dialing ? "Dialling…" : "Call lead"}
            </button>
          </form>
          {dialState.error && <p className="mt-2 text-sm text-red-600">{dialState.error}</p>}

          <form action={logCall} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="font-medium">Log a call</span>
              <input
                name="email"
                placeholder="lead email"
                className="mt-1 block w-44 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Outcome</span>
              <select
                name="outcome"
                className="mt-1 block rounded-xl border border-slate-300 px-2 py-1.5 text-sm"
              >
                {outcomes.map((outcome) => (
                  <option key={outcome} value={outcome}>
                    {outcome.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium">Seconds</span>
              <input
                type="number"
                name="durationSec"
                min={0}
                defaultValue={0}
                className="mt-1 block w-20 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <input
              name="notes"
              placeholder="Notes"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
            />
            <button
              disabled={logging}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-60"
            >
              Log
            </button>
          </form>
          {callState.error && <p className="mt-2 text-sm text-red-600">{callState.error}</p>}
        </div>
      </section>
    </div>
  );
}
