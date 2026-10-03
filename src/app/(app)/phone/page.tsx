import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { twilioAvailable } from "@/lib/twilio/client";
import { QUIET_START_HOUR, QUIET_END_HOUR, CALL_OUTCOMES } from "@/lib/twilio/rules";
import { updateNumberAction, removeNumberAction } from "@/lib/actions/phone";
import PhonePanels from "@/components/PhonePanels";

const SMS_STATUS_STYLES: Record<string, string> = {
  delivered: "bg-green-50 text-green-700",
  received: "bg-indigo-50 text-indigo-700",
  sent: "bg-slate-100 text-slate-600",
  queued: "bg-slate-100 text-slate-500",
  undelivered: "bg-red-50 text-red-700",
  failed: "bg-red-50 text-red-700",
};

export default async function PhonePage() {
  const { workspace, role } = await requireWorkspace();
  const canManage = role !== "member";
  const configured = twilioAvailable();

  const [numbers, messages, calls, textable] = await Promise.all([
    db.phoneNumber.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
    }),
    db.smsMessage.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { lead: { select: { email: true } } },
    }),
    db.callLog.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { lead: { select: { email: true } } },
    }),
    db.lead.count({
      where: { workspaceId: workspace.id, phone: { not: "" }, smsOptOutAt: null },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Calls &amp; SMS</h1>
        <p className="mt-1 text-sm text-slate-500">
          A second channel in the same sequences. Texts only go to leads with consent on file,
          between {QUIET_START_HOUR}:00 and {QUIET_END_HOUR}:00 in the campaign&rsquo;s timezone,
          and STOP unsubscribes immediately.
        </p>
      </div>

      {!configured && (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Twilio isn&rsquo;t connected, so nothing can send yet. Set{" "}
          <code className="font-mono text-xs">TWILIO_ACCOUNT_SID</code> and{" "}
          <code className="font-mono text-xs">TWILIO_AUTH_TOKEN</code> in{" "}
          <code className="font-mono text-xs">.env</code>, then point your number&rsquo;s messaging
          webhook at <code className="font-mono text-xs">/api/twilio/sms</code>. Consent, quiet
          hours and call logging all work without it.
        </p>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Sending numbers</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{numbers.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Leads reachable by SMS</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{textable}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Calls logged</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{calls.length}</p>
        </div>
      </div>

      <PhonePanels
        canManage={canManage}
        configured={configured}
        outcomes={[...CALL_OUTCOMES]}
        hasNumbers={numbers.length > 0}
      />

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold">Numbers</h2>
        </div>
        {numbers.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            No numbers yet. Add one above, or import them from Twilio.
          </p>
        ) : (
          <ul className="divide-y divide-slate-50">
            {numbers.map((number) => (
              <li key={number.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="font-mono text-sm font-medium">{number.number}</p>
                  <p className="text-xs text-slate-500">
                    {number.label || "no label"} · {number.sentToday}/{number.dailySmsLimit} texts
                    today · SMS {number.smsEnabled ? "on" : "off"}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <form action={updateNumberAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={number.id} />
                      <label className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          name="smsEnabled"
                          defaultChecked={number.smsEnabled}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                        />
                        SMS
                      </label>
                      <input
                        type="number"
                        name="dailySmsLimit"
                        defaultValue={number.dailySmsLimit}
                        min={1}
                        max={500}
                        className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      />
                      <button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium transition hover:bg-slate-50">
                        Save
                      </button>
                    </form>
                    <form action={removeNumberAction}>
                      <input type="hidden" name="id" value={number.id} />
                      <button className="text-xs text-red-600 underline hover:text-red-800">
                        Remove
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-2 gap-6">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold">Recent texts</h2>
          </div>
          {messages.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {messages.map((message) => (
                <li key={message.id} className="px-5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs text-slate-500">
                      {message.direction === "out" ? "→" : "←"}{" "}
                      {message.direction === "out" ? message.toNumber : message.fromNumber}
                      {message.lead ? ` · ${message.lead.email}` : ""}
                    </p>
                    <span
                      className={`rounded-lg px-1.5 py-0.5 text-xs ${SMS_STATUS_STYLES[message.status] ?? "bg-slate-100 text-slate-600"}`}
                    >
                      {message.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-700">{message.body.slice(0, 160)}</p>
                  {message.errorMessage && (
                    <p className="text-xs text-red-600">{message.errorMessage}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold">Recent calls</h2>
          </div>
          {calls.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {calls.map((call) => (
                <li key={call.id} className="px-5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {call.lead?.email ?? call.toNumber}
                    </p>
                    <span className="rounded-lg bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {call.outcome ? call.outcome.replace(/_/g, " ") : call.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {call.createdAt.toLocaleString()}
                    {call.durationSec ? ` · ${call.durationSec}s` : ""}
                  </p>
                  {call.notes && <p className="mt-0.5 text-sm text-slate-600">{call.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
