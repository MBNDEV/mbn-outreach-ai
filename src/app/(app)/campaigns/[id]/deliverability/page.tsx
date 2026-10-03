import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkContent, domainOf, type DnsHealth } from "@/lib/deliverability";
import { renderTemplate } from "@/lib/template";

// Content scores are computed on render rather than stored: copy changes in the
// editor every few minutes, and a saved score would be wrong more often than right.

const SEVERITY_STYLES = {
  high: "bg-red-50 text-red-700",
  medium: "bg-amber-50 text-amber-800",
  low: "bg-slate-100 text-slate-600",
} as const;

const SAMPLE = {
  email: "jane@example.com",
  first_name: "Jane",
  last_name: "Doe",
  company: "Example Co",
  title: "Owner",
};

function scoreTone(score: number): string {
  if (score >= 80) return "text-green-700";
  if (score >= 55) return "text-amber-700";
  return "text-red-700";
}

export default async function CampaignDeliverabilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspace } = await requireWorkspace();

  const [steps, accounts] = await Promise.all([
    db.sequenceStep.findMany({
      where: { campaignId: id, campaign: { workspaceId: workspace.id } },
      orderBy: { order: "asc" },
      include: { variants: true },
    }),
    db.emailAccount.findMany({
      where: { workspaceId: workspace.id, campaigns: { some: { campaignId: id } } },
    }),
  ]);

  const rows = steps.flatMap((step, index) =>
    step.variants.map((variant) => ({
      key: variant.id,
      step: index + 1,
      label: variant.label,
      enabled: variant.enabled,
      report: checkContent({
        // Score what a lead receives, not the template: spintax and fallbacks
        // change the wording that filters actually see.
        subject: renderTemplate(variant.subject, SAMPLE),
        body: renderTemplate(variant.body, SAMPLE),
      }),
    }))
  );

  const scored = rows.filter((row) => row.enabled);
  const average =
    scored.length === 0
      ? null
      : Math.round(scored.reduce((sum, row) => sum + row.report.score, 0) / scored.length);

  const senders = accounts.map((account) => {
    let dns: DnsHealth | null = null;
    try {
      dns = JSON.parse(account.dnsHealth) as DnsHealth;
    } catch {}
    const checks = dns ? [dns.spf, dns.dkim, dns.dmarc, dns.mx] : [];
    const passing = checks.filter(Boolean).length;
    return {
      id: account.id,
      email: account.email,
      domain: domainOf(account.email),
      checked: Boolean(account.dnsCheckedAt),
      passing,
      total: checks.length || 4,
      warmup: account.warmupEnabled,
    };
  });

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold">Copy check</h2>
            <p className="mt-1 text-sm text-slate-600">
              Every enabled variant, scored for the things spam filters weigh: trigger phrases,
              link count, shouting, and length.
            </p>
          </div>
          {average !== null && (
            <div className="shrink-0 text-right">
              <p className={`text-2xl font-semibold tabular-nums ${scoreTone(average)}`}>
                {average}
              </p>
              <p className="text-xs text-slate-500">average score</p>
            </div>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            No sequence steps yet.{" "}
            <Link href={`/campaigns/${id}/editor`} className="text-indigo-600 hover:underline">
              Write the first one
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {rows.map((row) => (
              <li key={row.key} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">
                    Step {row.step} · Variant {row.label}
                    {!row.enabled && <span className="ml-2 text-xs text-slate-400">disabled</span>}
                  </p>
                  <p className={`text-sm font-semibold tabular-nums ${scoreTone(row.report.score)}`}>
                    {row.report.score}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      {row.report.wordCount} words
                    </span>
                  </p>
                </div>
                {row.report.issues.length === 0 ? (
                  <p className="mt-2 text-sm text-green-700">Nothing flagged.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {row.report.issues.map((issue) => (
                      <li key={issue.message} className="flex items-start gap-2 text-sm">
                        <span
                          className={`mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLES[issue.severity]}`}
                        >
                          {issue.severity}
                        </span>
                        <span className="text-slate-600">{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Sending mailboxes</h2>
        <p className="mt-1 text-sm text-slate-600">
          Authentication and warmup state for the mailboxes this campaign sends from.
        </p>
        {senders.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
            No sending mailbox picked yet.{" "}
            <Link href={`/campaigns/${id}/settings`} className="text-indigo-600 hover:underline">
              Choose one in Settings
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {senders.map((sender) => (
              <li key={sender.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <Link
                    href={`/accounts/${sender.id}`}
                    className="text-sm font-medium text-indigo-700 hover:underline"
                  >
                    {sender.email}
                  </Link>
                  <p className="text-xs text-slate-500">{sender.domain}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-lg px-2 py-0.5 ${
                      sender.warmup ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    warmup {sender.warmup ? "on" : "off"}
                  </span>
                  <span
                    className={`rounded-lg px-2 py-0.5 ${
                      !sender.checked
                        ? "bg-slate-100 text-slate-600"
                        : sender.passing === sender.total
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-800"
                    }`}
                  >
                    {sender.checked ? `auth ${sender.passing}/${sender.total}` : "auth not checked"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
