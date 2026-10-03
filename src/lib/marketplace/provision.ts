import "server-only";
import { db } from "@/lib/db";
import { encryptJson } from "@/lib/vault";
import { checkAccountHealth, type SmtpCredentials } from "@/lib/mail/health";
import { planLimits } from "@/lib/plans";
import { dnsPlan, verifyDns, type DnsRecord, type MailProvider } from "@/lib/marketplace/dns";
import { registrar, mailboxHost } from "@/lib/marketplace/providers";

// Carries a paid order from "we own the name" to "a warming mailbox the send
// engine can use":
//
//   order paid → domain registered (or BYO) → DNS verified → mailbox created
//   → connected as an EmailAccount → health-checked → warmup on
//
// Each step is idempotent and records its own failure, so a tick that dies
// halfway resumes rather than double-provisioning.

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

async function fail(domainId: string, error: string): Promise<void> {
  await db.managedDomain.update({
    where: { id: domainId },
    data: { status: "failed", lastError: error.slice(0, 300) },
  });
}

/** Register the name if we can, then publish the DNS plan the user must set. */
async function advanceDomain(domain: {
  id: string;
  name: string;
  source: string;
  status: string;
  mailProvider: string;
}): Promise<void> {
  if (domain.status === "pending") {
    if (domain.source === "registrar") {
      const adapter = registrar();
      if (!adapter) {
        await fail(
          domain.id,
          "No registrar is configured, so this domain cannot be bought here. Register it yourself and re-add it as bring-your-own."
        );
        return;
      }
      const result = await adapter.register(domain.name);
      if (!result.ok) {
        await fail(domain.id, result.error);
        return;
      }
    }

    const records = dnsPlan(domain.name, domain.mailProvider as MailProvider, appUrl());
    await db.managedDomain.update({
      where: { id: domain.id },
      data: { status: "dns_pending", dnsRecords: JSON.stringify(records), lastError: "" },
    });
    // Fall through to verification rather than waiting for the next tick: a
    // domain whose records are already correct should not sit on "waiting on
    // DNS" for minutes with nothing to explain it.
  }

  {
    const stored = await db.managedDomain.findUniqueOrThrow({ where: { id: domain.id } });
    if (stored.status !== "dns_pending") return;
    let records: DnsRecord[] = [];
    try {
      records = JSON.parse(stored.dnsRecords) as DnsRecord[];
    } catch {}
    if (records.length === 0) {
      records = dnsPlan(domain.name, domain.mailProvider as MailProvider, appUrl());
    }
    const verification = await verifyDns(domain.name, records);
    await db.managedDomain.update({
      where: { id: domain.id },
      data: {
        status: verification.ready ? "verified" : "dns_pending",
        dnsCheckedAt: new Date(),
        dnsRecords: JSON.stringify(records),
        lastError: verification.ready
          ? ""
          : `Waiting on: ${verification.checks
              .filter((c) => c.record.required && !c.found)
              .map((c) => `${c.record.type} ${c.record.host}`)
              .join(", ")}`,
      },
    });
  }
}

/** Turn provisioned credentials into a live, warming EmailAccount. */
export async function connectMailbox(
  mailboxId: string,
  credentials: SmtpCredentials
): Promise<{ ok: true } | { ok: false; error: string }> {
  const mailbox = await db.managedMailbox.findUniqueOrThrow({
    where: { id: mailboxId },
    include: { domain: true },
  });

  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: mailbox.workspaceId },
  });
  const limits = planLimits(workspace.plan);
  const existing = await db.emailAccount.count({ where: { workspaceId: workspace.id } });
  if (existing >= limits.maxEmailAccounts) {
    const error = `Your ${limits.label} plan allows ${limits.maxEmailAccounts} mailboxes.`;
    await db.managedMailbox.update({
      where: { id: mailbox.id },
      data: { status: "failed", lastError: error },
    });
    return { ok: false, error };
  }

  const account = await db.emailAccount.upsert({
    where: { workspaceId_email: { workspaceId: workspace.id, email: mailbox.email } },
    create: {
      workspaceId: workspace.id,
      email: mailbox.email,
      senderFirstName: mailbox.firstName,
      senderLastName: mailbox.lastName,
      provider: "smtp",
      credentials: encryptJson(credentials),
      // A brand-new domain has no reputation. Start low and let warmup's ramp
      // raise it rather than sending at the plan ceiling on day one.
      dailyLimit: Math.min(10, limits.maxDailyEmailsPerAccount),
      warmupEnabled: true,
      warmupStartedAt: new Date(),
      tags: JSON.stringify(["marketplace"]),
    },
    update: { credentials: encryptJson(credentials), warmupEnabled: true },
  });

  const health = await checkAccountHealth(credentials);
  await db.emailAccount.update({
    where: { id: account.id },
    data: {
      status: health.ok ? "connected" : "error",
      statusMessage: health.message,
      lastCheckedAt: new Date(),
    },
  });

  await db.managedMailbox.update({
    where: { id: mailbox.id },
    data: {
      accountId: account.id,
      status: health.ok ? "ready" : "failed",
      lastError: health.ok ? "" : health.message,
    },
  });

  await settleOrders();
  return health.ok ? { ok: true } : { ok: false, error: health.message };
}

/** Create mailboxes on a verified domain, or park them for credentials. */
async function advanceMailboxes(domainId: string): Promise<void> {
  const mailboxes = await db.managedMailbox.findMany({
    where: { domainId, status: { in: ["pending", "provisioning"] } },
  });
  if (mailboxes.length === 0) return;

  const host = mailboxHost();
  for (const mailbox of mailboxes) {
    if (!host) {
      // No host configured: the customer creates the mailbox wherever they
      // like and pastes its credentials, which connectMailbox then verifies.
      await db.managedMailbox.update({
        where: { id: mailbox.id },
        data: { status: "awaiting_credentials" },
      });
      continue;
    }

    await db.managedMailbox.update({
      where: { id: mailbox.id },
      data: { status: "provisioning" },
    });
    const domain = await db.managedDomain.findUniqueOrThrow({ where: { id: domainId } });
    const created = await host.create({ email: mailbox.email, domain: domain.name });
    if (!created.ok) {
      await db.managedMailbox.update({
        where: { id: mailbox.id },
        data: { status: "failed", lastError: created.error.slice(0, 300) },
      });
      continue;
    }
    await connectMailbox(mailbox.id, {
      kind: "smtp",
      smtpHost: created.mailbox.smtpHost,
      smtpPort: created.mailbox.smtpPort,
      imapHost: created.mailbox.imapHost,
      imapPort: created.mailbox.imapPort,
      username: created.mailbox.username,
      password: created.mailbox.password,
    });
  }
}

let running = false;

export async function runProvisioningTick(): Promise<{ domains: number; errors: number }> {
  if (running) return { domains: 0, errors: 0 };
  running = true;
  try {
    const domains = await db.managedDomain.findMany({
      where: { status: { in: ["pending", "dns_pending", "verified"] } },
    });
    let errors = 0;

    for (const domain of domains) {
      try {
        if (domain.status !== "verified") {
          await advanceDomain(domain);
        }
        const current = await db.managedDomain.findUniqueOrThrow({ where: { id: domain.id } });
        if (current.status === "verified") {
          await advanceMailboxes(domain.id);
        }
      } catch (err) {
        errors += 1;
        console.error(`[marketplace] ${domain.name}:`, (err as Error).message);
        await fail(domain.id, (err as Error).message).catch(() => {});
      }
    }

    await settleOrders();
    return { domains: domains.length, errors };
  } finally {
    running = false;
  }
}

/** An order is complete once its domain is verified and no mailbox is pending. */
export async function settleOrders(): Promise<void> {
  const orders = await db.marketplaceOrder.findMany({
    where: { status: { in: ["paid", "provisioning"] } },
  });
  for (const order of orders) {
    const domain = await db.managedDomain.findFirst({
      where: { workspaceId: order.workspaceId, name: order.domainName },
      include: { mailboxes: true },
    });
    if (!domain) continue;

    if (domain.status === "failed") {
      await db.marketplaceOrder.update({
        where: { id: order.id },
        data: { status: "failed" },
      });
      continue;
    }

    const resolved =
      domain.status === "verified" &&
      domain.mailboxes.length > 0 &&
      domain.mailboxes.every((m) => ["ready", "failed"].includes(m.status));
    // An order where every mailbox failed is not complete, whatever the domain
    // did — the customer got nothing they can send from.
    const anyReady = domain.mailboxes.some((m) => m.status === "ready");

    await db.marketplaceOrder.update({
      where: { id: order.id },
      data: !resolved
        ? { status: "provisioning" }
        : anyReady
          ? { status: "complete", completedAt: new Date() }
          : { status: "failed" },
    });
  }
}

/** Kick one domain forward immediately, for the "Check DNS now" button. */
export async function recheckDomain(workspaceId: string, domainId: string): Promise<string> {
  const domain = await db.managedDomain.findFirst({
    where: { id: domainId, workspaceId },
  });
  if (!domain) return "Domain not found.";
  if (domain.status === "failed") {
    await db.managedDomain.update({
      where: { id: domain.id },
      data: { status: "pending", lastError: "" },
    });
  }
  await advanceDomain({ ...domain, status: domain.status === "failed" ? "pending" : domain.status });
  const updated = await db.managedDomain.findUniqueOrThrow({ where: { id: domain.id } });
  if (updated.status === "verified") {
    await advanceMailboxes(domain.id);
    return "DNS verified — mailboxes can be connected now.";
  }
  return updated.lastError || "Records are not visible yet. DNS can take up to an hour.";
}
