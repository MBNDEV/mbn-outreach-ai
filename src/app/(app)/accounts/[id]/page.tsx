import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { domainOf, type DnsHealth } from "@/lib/deliverability";
import { warmupTargetFor, warmupSentToday } from "@/lib/engine/warmup";
import type { PlacementDetails } from "@/lib/placement";
import WarmupForm from "@/components/WarmupForm";
import PlacementPanel from "@/components/PlacementPanel";
import { runDnsCheckAction } from "@/lib/actions/deliverability";
import { IconChevronLeft } from "@/components/icons";

function Check({ label, ok }: { label: string; ok: boolean | null }) {
  const style =
    ok === null
      ? "bg-slate-100 text-slate-600"
      : ok
        ? "bg-green-50 text-green-700"
        : "bg-red-50 text-red-700";
  return (
    <div className={`rounded-xl px-3 py-2 text-center ${style}`}>
      <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">
        {ok === null ? "Not checked" : ok ? "Pass" : "Missing"}
      </p>
    </div>
  );
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace, role } = await requireWorkspace();
  const account = await db.emailAccount.findFirst({
    where: { id, workspaceId: workspace.id },
  });
  if (!account) notFound();

  const [placementTests, poolSize] = await Promise.all([
    db.deliverabilityTest.findMany({
      where: { workspaceId: workspace.id, accountId: account.id, kind: "placement" },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    db.emailAccount.count({
      where: {
        status: "connected",
        warmupEnabled: true,
        id: { not: account.id },
        ...(account.warmupPoolOptIn ? {} : { workspaceId: workspace.id }),
      },
    }),
  ]);

  let dns: DnsHealth = { mx: null, spf: null, dkim: null, dmarc: null, notes: [] };
  try {
    dns = { ...dns, ...(JSON.parse(account.dnsHealth) as DnsHealth) };
  } catch {}

  const target = warmupTargetFor(account);
  const sentToday = warmupSentToday(account);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/accounts"
          aria-label="Back to accounts"
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          <IconChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{account.email}</h1>
          <p className="text-sm text-slate-500">
            {account.provider} · {account.status}
            {account.statusMessage ? ` · ${account.statusMessage}` : ""}
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Warmup</h2>
            <p className="mt-1 text-sm text-slate-600">
              Exchanges ordinary mail with other warmed mailboxes, answers a share of what
              arrives, and moves anything filtered as spam back to the inbox.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-semibold tabular-nums">
              {sentToday}
              <span className="text-base font-normal text-slate-400">/{target}</span>
            </p>
            <p className="text-xs text-slate-500">sent today</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-lg font-semibold tabular-nums">{account.warmupReceived}</p>
            <p className="text-xs text-slate-500">received</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-lg font-semibold tabular-nums">{account.warmupRescued}</p>
            <p className="text-xs text-slate-500">rescued from spam</p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-lg font-semibold tabular-nums">{poolSize}</p>
            <p className="text-xs text-slate-500">peers available</p>
          </div>
        </div>

        {account.warmupEnabled && poolSize === 0 && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Warmup is on but there is no peer to exchange with. Connect another mailbox, or opt
            into the shared pool below to pair with other workspaces.
          </p>
        )}

        {role === "member" ? (
          <p className="mt-4 text-sm text-slate-500">Ask an admin to change warmup settings.</p>
        ) : (
          <WarmupForm
            account={{
              id: account.id,
              warmupEnabled: account.warmupEnabled,
              warmupPoolOptIn: account.warmupPoolOptIn,
              warmupTarget: account.warmupTarget,
            }}
          />
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Domain authentication</h2>
            <p className="mt-1 text-sm text-slate-600">
              Live DNS lookups for {domainOf(account.email) || "this domain"}.
              {account.dnsCheckedAt
                ? ` Last checked ${account.dnsCheckedAt.toLocaleString()}.`
                : " Never checked."}
            </p>
          </div>
          <form action={runDnsCheckAction}>
            <input type="hidden" name="id" value={account.id} />
            <button className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50">
              Run check
            </button>
          </form>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-3">
          <Check label="SPF" ok={dns.spf} />
          <Check label="DKIM" ok={dns.dkim} />
          <Check label="DMARC" ok={dns.dmarc} />
          <Check label="MX" ok={dns.mx} />
        </div>

        {dns.notes.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm text-slate-600">
            {dns.notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="text-slate-300">—</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PlacementPanel
        accountId={account.id}
        tests={placementTests.map((test) => {
          let details: PlacementDetails | null = null;
          try {
            details = JSON.parse(test.details) as PlacementDetails;
          } catch {}
          return {
            id: test.id,
            score: test.score,
            summary: test.summary,
            createdAt: test.createdAt.toLocaleString(),
            seeds: details?.seeds ?? [],
            checked: Boolean(details?.checkedAt),
          };
        })}
      />
    </div>
  );
}
