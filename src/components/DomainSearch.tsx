"use client";

import { useActionState, useState } from "react";
import {
  searchDomainsAction,
  createOrderAction,
  type SearchState,
  type OrderState,
} from "@/lib/actions/marketplace";

const AVAILABILITY_STYLES: Record<string, string> = {
  available: "bg-green-50 text-green-700",
  taken: "bg-slate-100 text-slate-500",
  unknown: "bg-amber-50 text-amber-800",
};

export default function DomainSearch({
  canManage,
  canRegister,
  billingReady,
  providers,
  domainPrice,
  mailboxPrice,
}: {
  canManage: boolean;
  canRegister: boolean;
  billingReady: boolean;
  providers: Array<{ id: string; label: string }>;
  domainPrice: string;
  mailboxPrice: string;
}) {
  const [searchState, search, searching] = useActionState(searchDomainsAction, {} as SearchState);
  const [orderState, order, ordering] = useActionState(createOrderAction, {} as OrderState);
  const [chosen, setChosen] = useState("");

  const results = searchState.results ?? [];

  return (
    <div className="space-y-4">
      <form action={search} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm">
          <span className="font-medium">Find a sending domain</span>
          <span className="mt-0.5 block text-slate-500">
            Enter your brand and we&rsquo;ll check close variants. Availability comes from the
            registry itself.
          </span>
          <div className="mt-2 flex gap-2">
            <input
              name="seed"
              defaultValue={searchState.seed ?? ""}
              placeholder="mybizniche"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              disabled={searching}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
            >
              {searching ? "Checking…" : "Search"}
            </button>
          </div>
        </label>
        {searchState.error && <p className="mt-2 text-sm text-red-600">{searchState.error}</p>}

        {results.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {results.map((result) => (
              <li key={result.name}>
                <button
                  type="button"
                  onClick={() => setChosen(result.name)}
                  disabled={result.availability === "taken"}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed ${
                    chosen === result.name
                      ? "border-indigo-400 bg-indigo-50/50"
                      : "border-slate-200 hover:border-indigo-300"
                  }`}
                >
                  <span
                    className={result.availability === "taken" ? "text-slate-400" : "font-medium"}
                  >
                    {result.name}
                  </span>
                  <span
                    className={`rounded-lg px-1.5 py-0.5 text-xs ${AVAILABILITY_STYLES[result.availability]}`}
                  >
                    {result.availability === "unknown" ? "unclear" : result.availability}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {canManage && (
        <form action={order} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold">Add a sending domain</h2>
          <p className="mt-1 text-sm text-slate-600">
            {canRegister
              ? `We can register it for you (${domainPrice}/yr plus ${mailboxPrice}/mailbox per month), or you can bring one you already own.`
              : "Register the domain with any registrar, then add it here — the app handles DNS, connection and warmup from that point."}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="font-medium">Domain</span>
              <input
                name="domain"
                key={chosen}
                defaultValue={chosen}
                placeholder="trymybizniche.com"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Mail provider</span>
              <select
                name="mailProvider"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                Decides which DNS records we ask you for.
              </span>
            </label>
            <label className="text-sm">
              <span className="font-medium">Sender first name</span>
              <input
                name="firstName"
                placeholder="Ken"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Used for the mailbox address and the From name.
              </span>
            </label>
            <label className="text-sm">
              <span className="font-medium">Mailboxes</span>
              <input
                type="number"
                name="mailboxes"
                min={1}
                max={10}
                defaultValue={2}
                className="mt-1 w-24 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Several small mailboxes outsend one large one, safely.
              </span>
            </label>
          </div>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Who registers it?</legend>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="radio" name="source" value="byo" defaultChecked className="mt-1" />
              <span>
                <span className="font-medium">I already own it</span>
                <span className="block text-slate-500">
                  Free. You set the DNS records we list; nothing sends until they resolve.
                </span>
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="source"
                value="registrar"
                disabled={!canRegister || !billingReady}
                className="mt-1 disabled:opacity-40"
              />
              <span className={canRegister && billingReady ? "" : "text-slate-400"}>
                <span className="font-medium">Buy it through us</span>
                <span className="block">
                  {canRegister && billingReady
                    ? `${domainPrice}/yr — registered and configured automatically.`
                    : "Needs a connected registrar and Stripe prices before it can be offered."}
                </span>
              </span>
            </label>
          </fieldset>

          <button
            disabled={ordering}
            className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {ordering ? "Setting up…" : "Add domain"}
          </button>
          {orderState.error && <p className="mt-2 text-sm text-red-600">{orderState.error}</p>}
          {orderState.message && (
            <p className="mt-2 text-sm text-green-700">{orderState.message}</p>
          )}
        </form>
      )}
    </div>
  );
}
