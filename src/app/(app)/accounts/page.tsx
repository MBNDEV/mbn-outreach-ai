import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db, icontains } from "@/lib/db";
import {
  recheckAccountAction,
  deleteAccountAction,
} from "@/lib/actions/accounts";

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-green-50 text-green-700",
  pending: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; tag?: string; oauth_error?: string }>;
}) {
  const { workspace, role } = await requireWorkspace();
  const { q, status, tag, oauth_error: oauthError } = await searchParams;
  const canManage = role !== "member";

  const accounts = await db.emailAccount.findMany({
    where: {
      workspaceId: workspace.id,
      ...(status ? { status } : {}),
      ...(q ? { email: icontains(q) } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  const withTags = accounts
    .map((a) => ({ ...a, tagList: JSON.parse(a.tags) as string[] }))
    .filter((a) => !tag || a.tagList.includes(tag));

  const allTags = [...new Set(accounts.flatMap((a) => JSON.parse(a.tags) as string[]))];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Email Accounts</h1>
        {canManage && (
          <Link
            href="/accounts/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500"
          >
            Add accounts
          </Link>
        )}
      </div>

      {oauthError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-sm font-medium text-red-800">Mailbox connection failed</p>
          <p className="mt-0.5 text-sm text-red-700">{decodeURIComponent(oauthError)}</p>
        </div>
      )}

      <form className="mb-4 flex gap-3" action="/accounts" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search email…"
          className="w-64 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="connected">Connected</option>
          <option value="pending">Pending</option>
          <option value="error">Error</option>
        </select>
        <select
          name="tag"
          defaultValue={tag ?? ""}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button className="rounded-md border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100">
          Filter
        </button>
      </form>

      {withTags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-600">
          No email accounts match. Connect one to start sending.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Daily limit</th>
                <th className="px-4 py-3">Warmup</th>
                <th className="px-4 py-3">Tags</th>
                <th className="px-4 py-3">Last checked</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {withTags.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/accounts/${a.id}`} className="font-medium text-indigo-700 hover:underline">
                      {a.email}
                    </Link>
                    {(a.senderFirstName || a.senderLastName) && (
                      <p className="text-xs text-slate-500">
                        {a.senderFirstName} {a.senderLastName}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize">{a.provider}</td>
                  <td className="px-4 py-3">
                    <span
                      title={a.statusMessage}
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[a.status] ?? ""}`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {a.sentToday} / {a.dailyLimit}
                  </td>
                  <td className="px-4 py-3">
                    {a.warmupEnabled ? `${a.warmupSentToday} sent` : "Off"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {a.tagList.map((t) => (
                        <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {a.lastCheckedAt ? a.lastCheckedAt.toLocaleString() : "—"}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <form action={recheckAccountAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="text-xs text-slate-600 underline hover:text-slate-900">
                            Re-check
                          </button>
                        </form>
                        <form action={deleteAccountAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="text-xs text-red-600 underline hover:text-red-800">
                            Remove
                          </button>
                        </form>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
