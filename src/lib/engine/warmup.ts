import "server-only";
import crypto from "node:crypto";
import type { EmailAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { transportFor } from "@/lib/engine/transport";
import { textToHtml } from "@/lib/template";

// Warmup network: opted-in mailboxes send each other ordinary-looking mail so
// providers see a history of wanted conversation before any cold campaign runs.
// The peer pool spans workspaces when both sides opt in — traffic that never
// leaves one customer's own domains teaches an ESP very little.
//
// Reputation comes from the whole exchange, not the send: the receiving side
// (in sync.ts) marks warmup mail read, replies to some of it, and moves any
// copy that landed in spam back to the inbox.

export const WARMUP_HEADER = "x-warmup-token";

const RAMP_START = 2;
const RAMP_PER_DAY = 2;

const SUBJECTS = [
  "Following up on our chat",
  "Quick thought",
  "That resource I mentioned",
  "Re: next steps",
  "Checking in",
  "One more thing",
  "Notes from today",
];

const BODIES = [
  "Thanks again for the time earlier — the summary you sent was useful.\n\nI'll look it over and come back with questions this week.",
  "Just circling back on this. No rush at all, whenever you get a moment.",
  "Got it, that makes sense. I'll put together a short outline and share it.",
  "Appreciate the update. Let's pick this back up after the weekend.",
  "That works on my end. I'll send an invite across shortly.",
  "Good to hear. I'll review the notes and flag anything that stands out.",
];

function pick<T>(items: readonly T[]): T {
  return items[crypto.randomInt(items.length)];
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** How many warmup emails this mailbox should send today, ramping up from a
 *  handful so volume grows the way a real mailbox's would. */
export function warmupTargetFor(account: Pick<EmailAccount, "warmupStartedAt" | "warmupTarget">): number {
  if (!account.warmupStartedAt) return RAMP_START;
  const days = Math.floor((Date.now() - account.warmupStartedAt.getTime()) / 86400_000);
  return Math.max(RAMP_START, Math.min(account.warmupTarget, RAMP_START + days * RAMP_PER_DAY));
}

export function warmupSentToday(
  account: Pick<EmailAccount, "warmupDate" | "warmupSentToday">
): number {
  return account.warmupDate === utcDay(new Date()) ? account.warmupSentToday : 0;
}

/** Peers this mailbox may exchange with, cross-workspace first. */
function peersFor(sender: EmailAccount, pool: EmailAccount[]): EmailAccount[] {
  const usable = pool.filter(
    (peer) => peer.id !== sender.id && peer.email.toLowerCase() !== sender.email.toLowerCase()
  );
  if (!sender.warmupPoolOptIn) {
    return usable.filter((peer) => peer.workspaceId === sender.workspaceId);
  }
  const network = usable.filter((peer) => peer.workspaceId !== sender.workspaceId && peer.warmupPoolOptIn);
  return network.length > 0 ? network : usable.filter((peer) => peer.workspaceId === sender.workspaceId);
}

let warming = false;

export async function runWarmupTick(): Promise<{ sent: number; errors: number }> {
  if (warming) return { sent: 0, errors: 0 };
  warming = true;
  try {
    return await warmupPass();
  } finally {
    warming = false;
  }
}

async function warmupPass(): Promise<{ sent: number; errors: number }> {
  const pool = await db.emailAccount.findMany({
    where: { status: "connected", warmupEnabled: true },
  });
  if (pool.length < 2) return { sent: 0, errors: 0 };

  const today = utcDay(new Date());
  let sent = 0;
  let errors = 0;

  for (const sender of pool) {
    try {
      if (warmupSentToday(sender) >= warmupTargetFor(sender)) continue;
      const peers = peersFor(sender, pool);
      if (peers.length === 0) continue;
      const peer = pick(peers);

      const token = crypto.randomBytes(16).toString("hex");
      const subject = pick(SUBJECTS);
      const bodyText = pick(BODIES);
      const fromName = [sender.senderFirstName, sender.senderLastName].filter(Boolean).join(" ");

      const transport = await transportFor(sender);
      let messageId = "";
      try {
        const info = await transport.sendMail({
          from: fromName ? `"${fromName}" <${sender.email}>` : sender.email,
          to: peer.email,
          subject,
          text: bodyText,
          html: textToHtml(bodyText),
          headers: { [WARMUP_HEADER]: token },
        });
        messageId = info.messageId ?? "";
      } finally {
        transport.close();
      }

      await db.$transaction([
        db.message.create({
          data: {
            workspaceId: sender.workspaceId,
            accountId: sender.id,
            direction: "out",
            kind: "warmup",
            toEmail: peer.email,
            fromEmail: sender.email,
            subject,
            bodyText,
            messageId,
            trackingToken: token,
          },
        }),
        db.emailAccount.update({
          where: { id: sender.id },
          data: {
            warmupStartedAt: sender.warmupStartedAt ?? new Date(),
            ...(sender.warmupDate === today
              ? { warmupSentToday: { increment: 1 } }
              : { warmupSentToday: 1, warmupDate: today }),
          },
        }),
      ]);
      sent += 1;
    } catch (err) {
      errors += 1;
      console.error(`[warmup] ${sender.email}:`, (err as Error).message);
    }
  }
  return { sent, errors };
}

/** Warmup conversations need replies to look real; roughly a third get one. */
export function shouldReplyToWarmup(): boolean {
  return crypto.randomInt(100) < 35;
}

export const WARMUP_REPLIES = [
  "Sounds good — thanks for the update.",
  "Perfect, that works for me.",
  "Got it, appreciate you following up.",
  "Thanks, I'll take a look and reply properly tomorrow.",
];

export function warmupReplyBody(): string {
  return pick(WARMUP_REPLIES);
}
