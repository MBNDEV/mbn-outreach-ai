import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { planLimits, PLANS, type PlanId } from "@/lib/plans";
import {
  renameWorkspaceAction,
  revokeInviteAction,
  removeMemberAction,
  changeRoleAction,
} from "@/lib/actions/workspace";
import {
  revokeApiKeyAction,
  deleteWebhookAction,
  toggleWebhookAction,
} from "@/lib/actions/integrations";
import { addBlocklistAction, removeBlocklistAction } from "@/lib/actions/leads";
import { saveSlackWebhookAction } from "@/lib/actions/integrations";
import InviteForm from "@/components/InviteForm";
import BillingPanel from "@/components/BillingPanel";
import AgencyPanel from "@/components/AgencyPanel";
import { billingAvailable, CREDIT_PACK_SIZE } from "@/lib/billing";
import { ApiKeyCreator, WebhookCreator } from "@/components/IntegrationsPanel";

export default async function SettingsPage() {
  const { workspace, role } = await requireWorkspace();
  const canManage = role !== "member";
  const isOwner = role === "owner";
  const limits = planLimits(workspace.plan);

  const [members, invites, apiKeys, webhooks, blocklist, subWorkspaces] = await Promise.all([
    db.membership.findMany({
      where: { workspaceId: workspace.id },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.invitation.findMany({
      where: { workspaceId: workspace.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    }),
    db.apiKey.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    }),
    db.webhook.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    }),
    db.blocklistEntry.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
    }),
    db.workspace.findMany({
      where: { parentWorkspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, credits: true, createdAt: true },
    }),
  ]);

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="mb-6 text-2xl font-semibold">Workspace settings</h1>
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 font-medium">General</h2>
          <form action={renameWorkspaceAction} className="flex gap-3">
            <input
              name="name"
              defaultValue={workspace.name}
              disabled={!canManage}
              className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
            />
            {canManage && (
              <button className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100">
                Rename
              </button>
            )}
          </form>
          <p className="mt-3 text-xs text-slate-500">Workspace ID: {workspace.id}</p>
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-1 font-medium">Plan &amp; billing</h2>
        <p className="mb-4 text-sm text-slate-600">
          Current plan: <span className="font-medium">{limits.label}</span> —{" "}
          {limits.maxEmailAccounts} email accounts, {limits.maxMembers} members,{" "}
          {limits.maxDailyEmailsPerAccount} emails/day per account.
        </p>
        <BillingPanel
          workspace={{
            plan: workspace.plan,
            planStatus: workspace.planStatus,
            credits: workspace.credits,
            hasCustomer: Boolean(workspace.stripeCustomerId),
          }}
          configured={billingAvailable()}
          isOwner={isOwner}
          creditPackSize={CREDIT_PACK_SIZE}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-medium">Agency</h2>
        <AgencyPanel
          workspace={{
            plan: workspace.plan,
            isChild: Boolean(workspace.parentWorkspaceId),
            brandName: workspace.brandName,
            brandColor: workspace.brandColor,
            brandLogoUrl: workspace.brandLogoUrl,
          }}
          clients={subWorkspaces.map((child) => ({
            id: child.id,
            name: child.name,
            credits: child.credits,
            createdAt: child.createdAt.toLocaleDateString(),
          }))}
          isOwner={isOwner}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="mb-4 font-medium">
          Members ({members.length}/{limits.maxMembers})
        </h2>
        <table className="mb-6 w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2">Name</th>
              <th className="py-2">Email</th>
              <th className="py-2">Role</th>
              {canManage && <th className="py-2" />}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-slate-100">
                <td className="py-2">{m.user.name}</td>
                <td className="py-2">{m.user.email}</td>
                <td className="py-2">
                  {isOwner && m.role !== "owner" ? (
                    <form action={changeRoleAction} className="inline-flex items-center gap-2">
                      <input type="hidden" name="id" value={m.id} />
                      <select
                        name="role"
                        defaultValue={m.role}
                        className="rounded border border-slate-300 px-2 py-1 text-xs"
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                      <button className="text-xs underline">Save</button>
                    </form>
                  ) : (
                    <span className="capitalize">{m.role}</span>
                  )}
                </td>
                {canManage && (
                  <td className="py-2 text-right">
                    {m.role !== "owner" && (
                      <form action={removeMemberAction}>
                        <input type="hidden" name="id" value={m.id} />
                        <button className="text-xs text-red-600 underline">Remove</button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {canManage && (
          <>
            <h3 className="mb-3 text-sm font-medium">Invite someone</h3>
            <InviteForm />
            {invites.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 text-sm font-medium">Pending invitations</h3>
                <ul className="space-y-1 text-sm">
                  {invites.map((i) => (
                    <li key={i.id} className="flex items-center gap-3">
                      <span>{i.email}</span>
                      <span className="text-xs text-slate-500">({i.role})</span>
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="id" value={i.id} />
                        <button className="text-xs text-red-600 underline">Revoke</button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-1 font-medium">API keys</h2>
          <p className="mb-4 text-sm text-slate-600">
            Authenticate REST calls with <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">Authorization: Bearer &lt;key&gt;</code>{" "}
            against <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/api/v1/campaigns</code> and{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/api/v1/leads</code>.
          </p>
          {apiKeys.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm">
              {apiKeys.map((k) => (
                <li key={k.id} className="flex items-center gap-3">
                  <span className="font-medium">{k.name}</span>
                  <code className="text-xs text-slate-500">{k.prefix}…</code>
                  <span className="text-xs text-slate-400">
                    {k.lastUsedAt ? `last used ${k.lastUsedAt.toLocaleDateString()}` : "never used"}
                  </span>
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <button className="text-xs text-red-600 underline">Revoke</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <ApiKeyCreator />
        </section>
      )}

      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-1 font-medium">Webhooks</h2>
          <p className="mb-4 text-sm text-slate-600">
            POSTs a signed JSON payload (HMAC-SHA256 in{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">X-Webhook-Signature</code>) when events happen.
          </p>
          {webhooks.length > 0 && (
            <ul className="mb-4 space-y-2 text-sm">
              {webhooks.map((w) => (
                <li key={w.id} className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${w.enabled ? "bg-emerald-500" : "bg-slate-300"}`} />
                  <code className="max-w-xs truncate text-xs">{w.url}</code>
                  <span className="text-xs text-slate-500">
                    {(JSON.parse(w.events) as string[]).join(", ")}
                  </span>
                  <form action={toggleWebhookAction}>
                    <input type="hidden" name="id" value={w.id} />
                    <button className="text-xs text-slate-600 underline">
                      {w.enabled ? "Disable" : "Enable"}
                    </button>
                  </form>
                  <form action={deleteWebhookAction}>
                    <input type="hidden" name="id" value={w.id} />
                    <button className="text-xs text-red-600 underline">Delete</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <WebhookCreator />
        </section>
      )}

      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-1 font-medium">Slack</h2>
          <p className="mb-4 text-sm text-slate-600">
            Pings a channel when a human replies, and when a thread moves to a positive
            pipeline label. Everything quieter stays in the Unibox.
          </p>
          <form action={saveSlackWebhookAction} className="flex items-end gap-2">
            <label className="flex-1 text-sm">
              <span className="font-medium">Incoming webhook URL</span>
              <input
                name="slackWebhookUrl"
                type="url"
                defaultValue={workspace.slackWebhookUrl}
                placeholder="https://hooks.slack.com/services/…"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
              />
            </label>
            <button className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50">
              Save
            </button>
          </form>
        </section>
      )}

      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-1 font-medium">Blocklist</h2>
          <p className="mb-4 text-sm text-slate-600">
            Emails or whole domains that campaigns must never contact.
          </p>
          {blocklist.length > 0 && (
            <ul className="mb-4 flex flex-wrap gap-2 text-sm">
              {blocklist.map((b) => (
                <li
                  key={b.id}
                  className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  {b.value}
                  <form action={removeBlocklistAction}>
                    <input type="hidden" name="id" value={b.id} />
                    <button aria-label={`Remove ${b.value}`} className="text-slate-400 hover:text-red-600">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addBlocklistAction} className="flex gap-3">
            <input
              name="value"
              placeholder="competitor.com or ceo@bigclient.com"
              className="w-72 rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm"
            />
            <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500">
              Block
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
