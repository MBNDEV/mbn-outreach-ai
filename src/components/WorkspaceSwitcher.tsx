"use client";

import { useState } from "react";
import { switchWorkspaceAction } from "@/lib/actions/agency";
import { IconChevronLeft } from "@/components/icons";

interface WorkspaceOption {
  id: string;
  name: string;
  plan: string;
  isChild: boolean;
}

export default function WorkspaceSwitcher({
  active,
  workspaces,
  planLabel,
  brand,
}: {
  active: { id: string; name: string };
  workspaces: WorkspaceOption[];
  planLabel: string;
  brand: { name: string; color: string; logoUrl: string };
}) {
  const [open, setOpen] = useState(false);
  const only = workspaces.length < 2;
  const initial = (brand.name || active.name).slice(0, 1).toUpperCase();

  return (
    <div className="relative border-b border-slate-100 p-4">
      <button
        onClick={() => !only && setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={only ? undefined : "Switch workspace"}
        className={`flex w-full items-center gap-3 rounded-lg text-left ${
          only ? "cursor-default" : "transition-colors hover:bg-slate-50"
        }`}
      >
        {brand.logoUrl ? (
          // Logos are customer-supplied URLs, so next/image would need every
          // client domain whitelisted; a plain img keeps white-label setup free.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ backgroundColor: brand.color || "#4f46e5" }}
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{active.name}</p>
          <p className="text-xs text-slate-500">{planLabel} plan</p>
        </div>
        {!only && (
          <IconChevronLeft
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
              open ? "rotate-90" : "-rotate-90"
            }`}
          />
        )}
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-[4.25rem] z-10 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {workspaces.map((option) => (
            <form key={option.id} action={switchWorkspaceAction}>
              <input type="hidden" name="workspaceId" value={option.id} />
              <button
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${
                  option.id === active.id ? "font-semibold text-indigo-700" : "text-slate-700"
                }`}
              >
                <span className="truncate">
                  {option.isChild && <span className="mr-1 text-slate-400">↳</span>}
                  {option.name}
                </span>
                {option.id === active.id && <span className="text-xs">current</span>}
              </button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
