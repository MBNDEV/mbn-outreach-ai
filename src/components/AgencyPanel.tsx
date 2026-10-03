"use client";

import { useActionState } from "react";
import {
  createSubWorkspaceAction,
  saveBrandingAction,
  switchWorkspaceAction,
  type SubWorkspaceState,
} from "@/lib/actions/agency";

export default function AgencyPanel({
  workspace,
  clients,
  isOwner,
}: {
  workspace: {
    plan: string;
    isChild: boolean;
    brandName: string;
    brandColor: string;
    brandLogoUrl: string;
  };
  clients: Array<{ id: string; name: string; credits: number; createdAt: string }>;
  isOwner: boolean;
}) {
  const [state, create, pending] = useActionState(
    createSubWorkspaceAction,
    {} as SubWorkspaceState
  );
  const onAgencyPlan = workspace.plan === "agency";

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">White-label branding</h3>
        <p className="mt-1 text-sm text-slate-600">
          Replaces the product name and mark in the sidebar for everyone in this workspace. New
          client workspaces inherit whatever is set here.
        </p>
        {isOwner ? (
          <form action={saveBrandingAction} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="font-medium">Brand name</span>
              <input
                name="brandName"
                defaultValue={workspace.brandName}
                placeholder="My Biz Niche"
                className="mt-1 block w-48 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Accent colour</span>
              <input
                name="brandColor"
                defaultValue={workspace.brandColor}
                placeholder="#4f46e5"
                className="mt-1 block w-28 rounded-xl border border-slate-300 px-3 py-1.5 font-mono text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium">Logo URL</span>
              <input
                name="brandLogoUrl"
                defaultValue={workspace.brandLogoUrl}
                placeholder="https://…/logo.png"
                className="mt-1 block w-64 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <button className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50">
              Save branding
            </button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Only the workspace owner can change branding.</p>
        )}
      </div>

      <div className="border-t border-slate-100 pt-5">
        <h3 className="text-sm font-medium">Client workspaces</h3>
        {workspace.isChild ? (
          <p className="mt-1 text-sm text-slate-600">
            This is itself a client workspace, so it cannot own others.
          </p>
        ) : !onAgencyPlan ? (
          <p className="mt-1 text-sm text-slate-600">
            Client workspaces come with the Agency plan. Each client gets isolated mailboxes,
            campaigns and leads while billing stays on the parent workspace.
          </p>
        ) : (
          <>
            {clients.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No client workspaces yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {clients.map((client) => (
                  <li key={client.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">{client.name}</p>
                      <p className="text-xs text-slate-500">
                        {client.credits.toLocaleString()} credits · created {client.createdAt}
                      </p>
                    </div>
                    <form action={switchWorkspaceAction}>
                      <input type="hidden" name="workspaceId" value={client.id} />
                      <button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium transition hover:bg-slate-50">
                        Open
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {isOwner && (
              <form action={create} className="mt-4 flex items-end gap-2">
                <label className="text-sm">
                  <span className="font-medium">New client workspace</span>
                  <input
                    name="name"
                    placeholder="Acme Plumbing"
                    className="mt-1 block w-64 rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </label>
                <button
                  disabled={pending}
                  className="rounded-xl bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
                >
                  {pending ? "Creating…" : "Create"}
                </button>
              </form>
            )}
            {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
            {state.created && (
              <p className="mt-2 text-sm text-green-700">Created “{state.created}”.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
