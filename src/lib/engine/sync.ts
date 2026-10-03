import "server-only";
import crypto from "node:crypto";
import { simpleParser, type ParsedMail } from "mailparser";
import { db } from "@/lib/db";
import { imapClientFor, findSpamMailbox } from "@/lib/mail/imap";
import { dispatchWebhooks } from "@/lib/webhooks";
import { transportFor } from "@/lib/engine/transport";
import { WARMUP_HEADER, shouldReplyToWarmup, warmupReplyBody } from "@/lib/engine/warmup";
import type { EmailAccount } from "@prisma/client";

// Inbox sync: polls each connected mailbox's INBOX for messages above the
// stored UID high-water mark, classifies them (reply / auto-reply / bounce),
// threads them, and drives sequence stops. Runs on the instrumentation loop.

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery/i;
const BOUNCE_SUBJECT = /undeliver|delivery (status|failure)|returned mail|failure notice|delivery incomplete/i;
const OOO_SUBJECT = /out of (the )?office|auto[- ]?reply|automatic reply|abwesenheit|vacation/i;

export type InboundKind = "reply" | "auto_reply" | "bounce";

export function classifyInbound(parsed: {
  fromEmail: string;
  subject: string;
  autoSubmitted?: string;
  precedence?: string;
  contentType?: string;
}): InboundKind {
  if (
    BOUNCE_FROM.test(parsed.fromEmail) ||
    BOUNCE_SUBJECT.test(parsed.subject) ||
    (parsed.contentType ?? "").includes("multipart/report")
  ) {
    return "bounce";
  }
  const auto = (parsed.autoSubmitted ?? "").toLowerCase();
  const precedence = (parsed.precedence ?? "").toLowerCase();
  if (
    (auto && auto !== "no") ||
    precedence === "auto_reply" ||
    OOO_SUBJECT.test(parsed.subject)
  ) {
    return "auto_reply";
  }
  return "reply";
}

async function findOrCreateThread(opts: {
  workspaceId: string;
  accountId: string;
  contactEmail: string;
  subject: string;
  snippet: string;
  leadId?: string;
  campaignId?: string;
  at: Date;
}) {
  const existing = await db.thread.findFirst({
    where: {
      workspaceId: opts.workspaceId,
      contactEmail: opts.contactEmail,
      accountId: opts.accountId,
      done: false,
    },
    orderBy: { lastMessageAt: "desc" },
  });
  if (existing) {
    return db.thread.update({
      where: { id: existing.id },
      data: {
        snippet: opts.snippet,
        unread: true,
        lastMessageAt: opts.at,
        leadId: existing.leadId ?? opts.leadId,
        campaignId: existing.campaignId ?? opts.campaignId,
      },
    });
  }
  return db.thread.create({
    data: {
      workspaceId: opts.workspaceId,
      accountId: opts.accountId,
      contactEmail: opts.contactEmail,
      subject: opts.subject,
      snippet: opts.snippet,
      leadId: opts.leadId,
      campaignId: opts.campaignId,
      label: "lead",
      lastMessageAt: opts.at,
    },
  });
}

/**
 * Warmup mail is bookkeeping, not correspondence: it never reaches the Unibox
 * or the webhooks, but it does get counted and answered so the exchange looks
 * like a real conversation to the provider.
 */
async function ingestWarmup(
  account: EmailAccount,
  mail: { fromEmail: string; subject: string; messageId: string; token: string }
): Promise<void> {
  await db.$transaction([
    db.message.create({
      data: {
        workspaceId: account.workspaceId,
        accountId: account.id,
        direction: "in",
        kind: "warmup",
        toEmail: account.email,
        fromEmail: mail.fromEmail,
        subject: mail.subject,
        messageId: mail.messageId,
        trackingToken: crypto.randomBytes(16).toString("hex"),
      },
    }),
    db.emailAccount.update({
      where: { id: account.id },
      data: { warmupReceived: { increment: 1 } },
    }),
  ]);

  if (!mail.fromEmail || !shouldReplyToWarmup()) return;
  const body = warmupReplyBody();
  const transport = await transportFor(account);
  try {
    await transport.sendMail({
      from: account.email,
      to: mail.fromEmail,
      subject: mail.subject.startsWith("Re:") ? mail.subject : `Re: ${mail.subject}`,
      text: body,
      inReplyTo: mail.messageId || undefined,
      references: mail.messageId || undefined,
      headers: { [WARMUP_HEADER]: mail.token },
    });
  } finally {
    transport.close();
  }
}

export async function ingestInbound(
  account: EmailAccount,
  parsed: ParsedMail
): Promise<void> {
  const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase() ?? "";
  const subject = parsed.subject ?? "";
  const bodyText = (parsed.text ?? "").slice(0, 50_000);
  const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 140);
  const messageId = parsed.messageId ?? "";
  const inReplyTo = parsed.inReplyTo ?? "";
  const at = parsed.date ?? new Date();

  if (messageId) {
    const dupe = await db.message.findFirst({
      where: { workspaceId: account.workspaceId, messageId, direction: "in" },
    });
    if (dupe) return;
  }

  const warmupToken = parsed.headers.get(WARMUP_HEADER);
  if (typeof warmupToken === "string" && warmupToken) {
    await ingestWarmup(account, { fromEmail, subject, messageId, token: warmupToken });
    return;
  }

  const kind = classifyInbound({
    fromEmail,
    subject,
    autoSubmitted: parsed.headers.get("auto-submitted") as string | undefined,
    precedence: parsed.headers.get("precedence") as string | undefined,
    contentType: parsed.headers.get("content-type")?.toString(),
  });

  // Correlate with an outbound message: threading headers first, then the
  // sender address (bounces reference the original recipient in References).
  const refs = [
    inReplyTo,
    ...(Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : []),
  ].filter(Boolean);
  let related = refs.length
    ? await db.message.findFirst({
        where: {
          workspaceId: account.workspaceId,
          direction: "out",
          messageId: { in: refs },
        },
        include: { campaignLead: true },
      })
    : null;

  let lead =
    kind !== "bounce" && fromEmail
      ? await db.lead.findUnique({
          where: { workspaceId_email: { workspaceId: account.workspaceId, email: fromEmail } },
        })
      : null;
  if (!related && lead) {
    related = await db.message.findFirst({
      where: {
        workspaceId: account.workspaceId,
        direction: "out",
        toEmail: lead.email,
      },
      orderBy: { sentAt: "desc" },
      include: { campaignLead: true },
    });
  }

  const contactEmail = kind === "bounce" ? related?.toEmail ?? fromEmail : fromEmail;
  if (!lead && related) {
    lead = await db.lead.findUnique({
      where: {
        workspaceId_email: { workspaceId: account.workspaceId, email: related.toEmail },
      },
    });
  }

  const thread = await findOrCreateThread({
    workspaceId: account.workspaceId,
    accountId: account.id,
    contactEmail,
    subject,
    snippet: snippet || subject,
    leadId: lead?.id,
    campaignId: related?.campaignId ?? undefined,
    at,
  });

  await db.message.create({
    data: {
      workspaceId: account.workspaceId,
      accountId: account.id,
      campaignId: related?.campaignId,
      campaignLeadId: related?.campaignLeadId,
      threadId: thread.id,
      direction: "in",
      kind,
      toEmail: account.email,
      fromEmail,
      subject,
      bodyText,
      messageId,
      inReplyTo,
      trackingToken: crypto.randomBytes(16).toString("hex"),
      sentAt: at,
    },
  });

  // Sequence consequences.
  const campaignLead = related?.campaignLead;
  if (campaignLead && ["pending", "in_sequence", "completed"].includes(campaignLead.status)) {
    if (kind === "bounce") {
      await db.campaignLead.update({
        where: { id: campaignLead.id },
        data: { status: "bounced", statusNote: subject.slice(0, 200), nextSendAt: null },
      });
    } else if (kind === "reply") {
      const campaign = related?.campaignId
        ? await db.campaign.findUnique({ where: { id: related.campaignId } })
        : null;
      if (!campaign || campaign.stopOnReply) {
        await db.campaignLead.update({
          where: { id: campaignLead.id },
          data: { status: "replied", statusNote: "Lead replied", nextSendAt: null },
        });
      }
    } else if (kind === "auto_reply" && campaignLead.nextSendAt) {
      // OOO: push the next touch out three days rather than stopping.
      await db.campaignLead.update({
        where: { id: campaignLead.id },
        data: { nextSendAt: new Date(campaignLead.nextSendAt.getTime() + 3 * 86400_000) },
      });
    }
  }

  if (kind === "auto_reply") {
    await db.thread.update({ where: { id: thread.id }, data: { label: "out_of_office" } });
  } else if (kind === "reply") {
    // AI reply classification (best-effort; heuristic default stays "lead").
    try {
      const { aiAvailable, classifyReply } = await import("@/lib/ai");
      if (aiAvailable()) {
        const label = await classifyReply({ subject, body: bodyText });
        if (label !== "lead") {
          await db.thread.update({ where: { id: thread.id }, data: { label } });
          const { syncOpportunityFromThread } = await import("@/lib/crm");
          await syncOpportunityFromThread(thread.id);
        }
      }
    } catch (err) {
      console.error("[sync] reply classification failed:", (err as Error).message);
    }
  }

  if (kind === "reply") {
    const { notifyReply } = await import("@/lib/notify");
    await notifyReply({
      workspaceId: account.workspaceId,
      from: fromEmail,
      subject,
      snippet: snippet || subject,
      appUrl: process.env.APP_URL ?? "http://localhost:3000",
    });
  }

  await dispatchWebhooks(account.workspaceId, kind === "bounce" ? "bounce_received" : "reply_received", {
    threadId: thread.id,
    from: fromEmail,
    subject,
    kind,
    campaignId: related?.campaignId ?? null,
  });
}

/**
 * New messages one pass will take. `source: true` holds each raw message in
 * memory, so an inbox that filled up while syncing was broken drains over
 * several passes instead of in one heap-sized gulp.
 */
const MAX_PER_PASS = 50;

export async function syncAccount(account: EmailAccount): Promise<number> {
  const client = await imapClientFor(account);
  const batch: { uid: number; source: Buffer }[] = [];
  let highest = account.lastSeenUid;
  let ingested = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      if (!mailbox || typeof mailbox === "boolean") return 0;
      const uidNext = mailbox.uidNext ?? 1;

      // First sync: start from now — don't ingest historical mail.
      if (account.lastSeenUid === 0) {
        await db.emailAccount.update({
          where: { id: account.id },
          data: { lastSeenUid: uidNext - 1, lastSyncAt: new Date() },
        });
        return 0;
      }
      if (uidNext - 1 <= account.lastSeenUid) {
        await db.emailAccount.update({
          where: { id: account.id },
          data: { lastSyncAt: new Date() },
        });
        return 0;
      }

      // Collect now, ingest once the session is closed: ingestInbound calls out
      // to Claude, Slack and customer webhooks, and stalling the fetch stream on
      // those is what makes a provider hang up mid-pass.
      for await (const msg of client.fetch(
        `${account.lastSeenUid + 1}:*`,
        { uid: true, source: true },
        { uid: true }
      )) {
        highest = Math.max(highest, msg.uid);
        if (msg.source) batch.push({ uid: msg.uid, source: msg.source });
        if (batch.length >= MAX_PER_PASS) break;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  for (const msg of batch) {
    try {
      const parsed = await simpleParser(msg.source);
      // Skip our own sent copies that some providers drop into INBOX.
      const from = parsed.from?.value?.[0]?.address?.toLowerCase();
      if (from === account.email.toLowerCase()) continue;
      await ingestInbound(account, parsed);
      ingested += 1;
    } catch (err) {
      console.error(`[sync] uid ${msg.uid} failed:`, (err as Error).message);
    }
  }

  // Cursor last: a crash part-way through re-fetches next pass rather than
  // losing the mail, and ingestInbound already drops duplicate Message-IDs.
  await db.emailAccount.update({
    where: { id: account.id },
    data: { lastSeenUid: highest, lastSyncAt: new Date() },
  });
  return ingested;
}

let syncing = false;

export async function runInboxSync(): Promise<{ ingested: number; errors: number }> {
  // Two concurrent passes over the same mailbox both fetch above the stored UID
  // and would ingest every message twice; the manual "Sync now" button can also
  // land mid-interval.
  if (syncing) return { ingested: 0, errors: 0 };
  syncing = true;
  try {
    return await syncPass();
  } finally {
    syncing = false;
  }
}

/**
 * Move warmup mail that a provider filed as spam back into the inbox — the
 * single strongest signal a warmup pool can send, since it tells the filter its
 * verdict was wrong. Returns how many were rescued. Rescued copies re-enter the
 * INBOX above the UID cursor, so the normal pass picks them up and answers them.
 */
export async function rescueWarmupFromSpam(account: EmailAccount): Promise<number> {
  const client = await imapClientFor(account);
  let rescued = 0;
  await client.connect();
  try {
    const spamPath = await findSpamMailbox(client);
    if (!spamPath) return 0;
    const lock = await client.getMailboxLock(spamPath);
    try {
      const since = new Date(Date.now() - 7 * 86400_000);
      const uids: number[] = [];
      for await (const msg of client.fetch(
        { since },
        { uid: true, headers: [WARMUP_HEADER] },
        { uid: true }
      )) {
        const headers = msg.headers?.toString() ?? "";
        if (headers.toLowerCase().includes(WARMUP_HEADER)) uids.push(msg.uid);
      }
      // The move waits for the scan to finish — issuing another command while a
      // fetch is still streaming is what drops the connection.
      if (uids.length) {
        await client.messageMove(uids.join(","), "INBOX", { uid: true });
        rescued = uids.length;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  if (rescued > 0) {
    await db.emailAccount.update({
      where: { id: account.id },
      data: { warmupRescued: { increment: rescued } },
    });
  }
  return rescued;
}

async function syncPass(): Promise<{ ingested: number; errors: number }> {
  const accounts = await db.emailAccount.findMany({ where: { status: "connected" } });
  let ingested = 0;
  let errors = 0;
  for (const account of accounts) {
    try {
      if (account.warmupEnabled) {
        // Best-effort: a provider that hides or renames its spam folder must not
        // stop the inbox pass that follows.
        await rescueWarmupFromSpam(account).catch((err: Error) =>
          console.error(`[warmup] spam sweep ${account.email}:`, err.message)
        );
      }
      ingested += await syncAccount(account);
    } catch (err) {
      errors += 1;
      console.error(`[sync] ${account.email}:`, (err as Error).message);
    }
  }
  return { ingested, errors };
}
