"use client";

import { useActionState } from "react";
import {
  startPlacementAction,
  checkPlacementAction,
} from "@/lib/actions/deliverability";
import type { FormState } from "@/lib/actions/auth";
import type { Placement } from "@/lib/placement";

const PLACEMENT_STYLES: Record<Placement, string> = {
  inbox: "bg-green-50 text-green-700",
  spam: "bg-red-50 text-red-700",
  missing: "bg-slate-100 text-slate-600",
};

const PLACEMENT_LABELS: Record<Placement, string> = {
  inbox: "Inbox",
  spam: "Spam",
  missing: "Not delivered",
};

interface TestRow {
  id: string;
  score: number;
  summary: string;
  createdAt: string;
  seeds: Array<{ email: string; placement: Placement }>;
  checked: boolean;
}

export default function PlacementPanel({
  accountId,
  tests,
}: {
  accountId: string;
  tests: TestRow[];
}) {
  const [startState, start, starting] = useActionState(startPlacementAction, {} as FormState);
  const [checkState, check, checking] = useActionState(checkPlacementAction, {} as FormState);
  const error = startState.error ?? checkState.error;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Inbox placement</h2>
          <p className="mt-1 text-sm text-slate-600">
            Sends a probe from this mailbox to every other connected mailbox in the workspace,
            then reports which folder each copy landed in.
          </p>
        </div>
        <form action={start}>
          <input type="hidden" name="id" value={accountId} />
          <button
            disabled={starting}
            className="rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {starting ? "Sending…" : "Run test"}
          </button>
        </form>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {tests.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
          No placement tests yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {tests.map((test) => (
            <li key={test.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {test.checked ? `${test.score}% inbox` : "Awaiting delivery"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {test.createdAt} · {test.summary}
                  </p>
                </div>
                <form action={check}>
                  <input type="hidden" name="id" value={accountId} />
                  <input type="hidden" name="testId" value={test.id} />
                  <button
                    disabled={checking}
                    className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {checking ? "Checking…" : test.checked ? "Re-check" : "Check now"}
                  </button>
                </form>
              </div>
              {test.seeds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {test.seeds.map((seed) => (
                    <span
                      key={seed.email}
                      className={`rounded-lg px-2 py-0.5 text-xs ${PLACEMENT_STYLES[seed.placement]}`}
                    >
                      {seed.email} · {PLACEMENT_LABELS[seed.placement]}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
