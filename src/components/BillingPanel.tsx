"use client";

import { useActionState } from "react";
import {
  startPlanCheckoutAction,
  startCreditCheckoutAction,
  openBillingPortalAction,
} from "@/lib/actions/billing";
import { PLANS, type PlanId } from "@/lib/plans";
import type { FormState } from "@/lib/actions/auth";

const STATUS_NOTE: Record<string, string> = {
  past_due: "Payment failed — update your card to avoid losing plan limits.",
  canceled: "Subscription canceled. The workspace is on Free limits.",
};

export default function BillingPanel({
  workspace,
  configured,
  isOwner,
  creditPackSize,
}: {
  workspace: { plan: string; planStatus: string; credits: number; hasCustomer: boolean };
  configured: boolean;
  isOwner: boolean;
  creditPackSize: number;
}) {
  const [planState, planCheckout, planPending] = useActionState(
    startPlanCheckoutAction,
    {} as FormState
  );
  const [creditState, creditCheckout, creditPending] = useActionState(
    startCreditCheckoutAction,
    {} as FormState
  );
  const [portalState, openPortal, portalPending] = useActionState(
    openBillingPortalAction,
    {} as FormState
  );
  const error = planState.error ?? creditState.error ?? portalState.error;
  const note = STATUS_NOTE[workspace.planStatus];

  return (
    <div className="space-y-4">
      {note && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{note}</p>
      )}
      {!configured && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Checkout is inactive until <code className="font-mono text-xs">STRIPE_SECRET_KEY</code>{" "}
          and the price IDs are set in <code className="font-mono text-xs">.env</code>. Plans can
          still be changed directly in the database meanwhile.
        </p>
      )}

      <div className="grid grid-cols-4 gap-3 text-sm">
        {(Object.keys(PLANS) as PlanId[]).map((plan) => {
          const current = plan === workspace.plan;
          return (
            <div
              key={plan}
              className={`flex flex-col rounded-xl border p-3 ${
                current ? "border-slate-900" : "border-slate-200"
              }`}
            >
              <p className="font-medium">{PLANS[plan].label}</p>
              <p className="mt-1 text-xs text-slate-500">
                {PLANS[plan].maxEmailAccounts} accounts · {PLANS[plan].maxMembers} members
              </p>
              <div className="mt-3">
                {current ? (
                  <span className="text-xs font-medium text-slate-500">Current plan</span>
                ) : plan === "free" ? (
                  <span className="text-xs text-slate-400">Downgrade via the portal</span>
                ) : isOwner ? (
                  <form action={planCheckout}>
                    <input type="hidden" name="plan" value={plan} />
                    <button
                      disabled={planPending || !configured}
                      className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {planPending ? "Opening…" : "Choose"}
                    </button>
                  </form>
                ) : (
                  <span className="text-xs text-slate-400">Owner only</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-4 border-t border-slate-100 pt-4">
        <form action={creditCheckout} className="flex items-end gap-2">
          <label className="text-sm">
            <span className="font-medium">Credit packs</span>
            <span className="block text-xs text-slate-500">
              {creditPackSize.toLocaleString()} credits each · balance{" "}
              {workspace.credits.toLocaleString()}
            </span>
            <input
              type="number"
              name="packs"
              min={1}
              max={100}
              defaultValue={1}
              className="mt-1 w-20 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
            />
          </label>
          <button
            disabled={creditPending || !configured}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-50"
          >
            {creditPending ? "Opening…" : "Buy credits"}
          </button>
        </form>

        {isOwner && workspace.hasCustomer && (
          <form action={openPortal}>
            <button
              disabled={portalPending}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50 disabled:opacity-50"
            >
              {portalPending ? "Opening…" : "Manage billing"}
            </button>
          </form>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
