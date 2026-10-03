"use client";

import { useActionState } from "react";
import { saveCampaignSettingsAction } from "@/lib/actions/campaigns";
import type { FormState } from "@/lib/actions/auth";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Manila",
  "Asia/Singapore",
  "Australia/Sydney",
];

const inputCls =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

interface AccountOption {
  id: string;
  email: string;
  status: string;
  selected: boolean;
}

export default function CampaignSettingsForm({
  campaign,
  accounts,
}: {
  campaign: {
    id: string;
    timezone: string;
    sendDays: string;
    windowStart: number;
    windowEnd: number;
    dailyLimit: number;
    gapMinutes: number;
    gapJitter: number;
    trackOpens: boolean;
    trackClicks: boolean;
    stopOnReply: boolean;
    unsubscribeLink: boolean;
  };
  accounts: AccountOption[];
}) {
  const [state, formAction, pending] = useActionState(
    saveCampaignSettingsAction,
    {} as FormState
  );
  const sendDays = JSON.parse(campaign.sendDays) as number[];

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <input type="hidden" name="id" value={campaign.id} />

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-medium">Sending accounts</h2>
        <p className="mt-1 text-sm text-slate-500">
          Emails rotate across the selected connected mailboxes.
        </p>
        <div className="mt-4 space-y-2">
          {accounts.length === 0 && (
            <p className="text-sm text-slate-500">
              No email accounts yet — connect one under Email Accounts first.
            </p>
          )}
          {accounts.map((a) => (
            <label
              key={a.id}
              className={`flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors ${
                a.status === "connected"
                  ? "border-slate-200 hover:border-indigo-300"
                  : "border-slate-100 opacity-60"
              }`}
            >
              <input
                type="checkbox"
                name="accountIds"
                value={a.id}
                defaultChecked={a.selected}
                disabled={a.status !== "connected"}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-medium">{a.email}</span>
              <span className="text-xs text-slate-500">
                {a.status === "connected" ? "connected" : `unavailable (${a.status})`}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-medium">Schedule</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {DAY_LABELS.map((label, d) => (
            <label
              key={d}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm has-checked:border-indigo-400 has-checked:bg-indigo-50 has-checked:text-indigo-700"
            >
              <input
                type="checkbox"
                name={`day${d}`}
                defaultChecked={sendDays.includes(d)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <label>
            <span className="mb-1 block font-medium text-slate-700">From (hour)</span>
            <input
              name="windowStart"
              type="number"
              min={0}
              max={23}
              defaultValue={campaign.windowStart}
              className={`${inputCls} w-full`}
            />
          </label>
          <label>
            <span className="mb-1 block font-medium text-slate-700">To (hour)</span>
            <input
              name="windowEnd"
              type="number"
              min={1}
              max={24}
              defaultValue={campaign.windowEnd}
              className={`${inputCls} w-full`}
            />
          </label>
          <label>
            <span className="mb-1 block font-medium text-slate-700">Timezone</span>
            <select name="timezone" defaultValue={campaign.timezone} className={`${inputCls} w-full`}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <label>
            <span className="mb-1 block font-medium text-slate-700">Daily limit</span>
            <input
              name="dailyLimit"
              type="number"
              min={1}
              defaultValue={campaign.dailyLimit}
              className={`${inputCls} w-full`}
            />
          </label>
          <label>
            <span className="mb-1 block font-medium text-slate-700">Gap (minutes)</span>
            <input
              name="gapMinutes"
              type="number"
              min={1}
              defaultValue={campaign.gapMinutes}
              className={`${inputCls} w-full`}
            />
          </label>
          <label>
            <span className="mb-1 block font-medium text-slate-700">Random extra (min)</span>
            <input
              name="gapJitter"
              type="number"
              min={0}
              defaultValue={campaign.gapJitter}
              className={`${inputCls} w-full`}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="font-medium">Tracking & deliverability</h2>
        <div className="mt-4 space-y-3 text-sm">
          {(
            [
              ["trackOpens", "Track opens", "Adds an invisible tracking pixel.", campaign.trackOpens],
              ["trackClicks", "Track link clicks", "Rewrites links through the tracking domain.", campaign.trackClicks],
              ["stopOnReply", "Stop on reply", "Stops the sequence when the lead replies (activates with inbox sync).", campaign.stopOnReply],
              ["unsubscribeLink", "Unsubscribe link", "Appends an unsubscribe footer and one-click List-Unsubscribe headers.", campaign.unsubscribeLink],
            ] as const
          ).map(([name, label, hint, checked]) => (
            <label key={name} className="flex items-start gap-3">
              <input
                type="checkbox"
                name={name}
                defaultChecked={checked}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="font-medium text-slate-800">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {state.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      <button
        disabled={pending}
        className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}
