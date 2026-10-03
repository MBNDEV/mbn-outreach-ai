"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState } from "react";
import {
  renameCampaignAction,
  setCampaignStatusAction,
  type LaunchState,
} from "@/lib/actions/campaigns";
import StatusPill from "@/components/StatusPill";
import { IconChevronLeft } from "@/components/icons";

const TABS = [
  { slug: "analytics", label: "Analytics" },
  { slug: "editor", label: "Editor" },
  { slug: "leads", label: "Leads" },
  { slug: "settings", label: "Settings" },
  { slug: "deliverability", label: "Deliverability" },
];

export default function CampaignHeader({
  campaign,
}: {
  campaign: { id: string; name: string; status: string };
}) {
  const pathname = usePathname();
  const [launchState, launchAction, launching] = useActionState(
    setCampaignStatusAction,
    {} as LaunchState
  );
  const nextStatus = campaign.status === "active" ? "paused" : "active";

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/campaigns"
            aria-label="Back to campaigns"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <IconChevronLeft className="h-5 w-5" />
          </Link>
          <form action={renameCampaignAction} className="min-w-0">
            <input type="hidden" name="id" value={campaign.id} />
            <input
              name="name"
              defaultValue={campaign.name}
              onBlur={(e) => e.target.form?.requestSubmit()}
              className="w-72 truncate rounded-lg border border-transparent bg-transparent px-2 py-1 text-xl font-semibold tracking-tight outline-none transition-colors hover:border-slate-200 focus:border-indigo-400 focus:bg-white"
            />
          </form>
          <StatusPill status={campaign.status} />
        </div>
        <form action={launchAction} className="flex items-center gap-3">
          <input type="hidden" name="id" value={campaign.id} />
          <input type="hidden" name="status" value={nextStatus} />
          {launchState.error && (
            <p className="text-sm text-red-600">{launchState.error}</p>
          )}
          <button
            disabled={launching}
            className={`rounded-lg px-5 py-2 text-sm font-medium text-white shadow-sm transition-colors disabled:opacity-50 ${
              campaign.status === "active"
                ? "bg-amber-500 hover:bg-amber-400"
                : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {launching ? "Working…" : campaign.status === "active" ? "Pause" : "Launch"}
          </button>
        </form>
      </div>

      <nav className="mt-5 flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => {
          const href = `/campaigns/${campaign.id}/${tab.slug}`;
          const active = pathname === href;
          return (
            <Link
              key={tab.slug}
              href={href}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
