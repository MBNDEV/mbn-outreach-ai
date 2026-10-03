import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  marketplaceCapabilities,
  domainPriceCents,
  mailboxPriceCents,
  formatPrice,
} from "@/lib/marketplace/providers";
import { MAIL_PROVIDERS, type DnsRecord } from "@/lib/marketplace/dns";
import { billingAvailable } from "@/lib/billing";
import DomainSearch from "@/components/DomainSearch";
import DomainCard from "@/components/DomainCard";

export default async function MarketplacePage() {
  const { workspace, role } = await requireWorkspace();
  const canManage = role !== "member";
  const capabilities = marketplaceCapabilities();

  const domains = await db.managedDomain.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    include: { mailboxes: { orderBy: { email: "asc" } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Domains &amp; mailboxes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Send from a separate domain, not the one your website runs on — cold mail that goes
          wrong should never take your main domain&rsquo;s reputation with it.
        </p>
      </div>

      {!capabilities.canRegister && (
        <p className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
          No registrar is connected, so domains can&rsquo;t be bought here yet. Search below to
          find a free name, register it wherever you like, then add it as{" "}
          <span className="font-medium">a domain you already own</span> — the DNS records, checks,
          mailbox connection and warmup all work the same way.
          {capabilities.canHostMailboxes
            ? ""
            : " Mailbox creation is manual for the same reason; you paste the credentials once and the app takes over."}
        </p>
      )}

      <DomainSearch
        canManage={canManage}
        canRegister={capabilities.canRegister}
        billingReady={billingAvailable()}
        providers={MAIL_PROVIDERS.map((p) => ({ ...p }))}
        domainPrice={formatPrice(domainPriceCents())}
        mailboxPrice={formatPrice(mailboxPriceCents())}
      />

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Your sending domains</h2>
        {domains.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            No sending domains yet. Search for one above, or add a domain you already own.
          </p>
        ) : (
          domains.map((domain) => {
            let records: DnsRecord[] = [];
            try {
              records = JSON.parse(domain.dnsRecords) as DnsRecord[];
            } catch {}
            return (
              <DomainCard
                key={domain.id}
                canManage={canManage}
                domain={{
                  id: domain.id,
                  name: domain.name,
                  status: domain.status,
                  source: domain.source,
                  mailProvider: domain.mailProvider,
                  lastError: domain.lastError,
                  checkedAt: domain.dnsCheckedAt?.toLocaleString() ?? null,
                  records,
                }}
                mailboxes={domain.mailboxes.map((mailbox) => ({
                  id: mailbox.id,
                  email: mailbox.email,
                  status: mailbox.status,
                  lastError: mailbox.lastError,
                  accountId: mailbox.accountId,
                }))}
              />
            );
          })
        )}
      </section>

      <p className="text-xs text-slate-500">
        Connected mailboxes appear in{" "}
        <Link href="/accounts" className="text-indigo-600 hover:underline">
          Email Accounts
        </Link>{" "}
        and start warming automatically at a low daily limit.
      </p>
    </div>
  );
}
