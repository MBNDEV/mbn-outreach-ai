import "server-only";
import crypto from "node:crypto";
import type { ImapFlow } from "imapflow";
import { db } from "@/lib/db";
import { transportFor } from "@/lib/engine/transport";
import { imapClientFor, findSpamMailbox } from "@/lib/mail/imap";
import { textToHtml } from "@/lib/template";

// Inbox-placement test against the workspace's own mailboxes as seeds. Real
// placement services keep seed accounts at every major provider; this covers
// the providers the customer already has connected, which is the case that
// matters most to them and needs no partner contract.
//
// Two phases because delivery is not instant: send, then check where each seed
// copy landed. The header token is what identifies our probe in each mailbox.

const PLACEMENT_HEADER = "x-placement-token";

export type Placement = "inbox" | "spam" | "missing";

export interface SeedResult {
  email: string;
  placement: Placement;
}

export interface PlacementDetails {
  token: string;
  subject: string;
  seeds: SeedResult[];
  checkedAt?: string;
}

async function tokenIn(client: ImapFlow, mailbox: string, token: string): Promise<boolean> {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const since = new Date(Date.now() - 2 * 86400_000);
    for await (const msg of client.fetch(
      { since },
      { uid: true, headers: [PLACEMENT_HEADER] },
      { uid: true }
    )) {
      if ((msg.headers?.toString() ?? "").includes(token)) return true;
    }
    return false;
  } finally {
    lock.release();
  }
}

/** Send the probe to every other connected mailbox in the workspace. */
export async function startPlacementTest(
  workspaceId: string,
  accountId: string
): Promise<{ testId: string; seeds: number } | { error: string }> {
  const sender = await db.emailAccount.findFirst({
    where: { id: accountId, workspaceId },
  });
  if (!sender) return { error: "Mailbox not found." };
  if (sender.status !== "connected") return { error: "Connect this mailbox before testing it." };

  const seeds = await db.emailAccount.findMany({
    where: { workspaceId, status: "connected", id: { not: sender.id } },
  });
  if (seeds.length === 0) {
    return {
      error:
        "A placement test needs a second connected mailbox to receive the probe. Connect one more and try again.",
    };
  }

  const token = crypto.randomBytes(12).toString("hex");
  const subject = `Deliverability check ${token.slice(0, 6)}`;
  const bodyText =
    "This is an automated inbox-placement probe sent by your own workspace.\n\nNothing to action — it only records which folder it lands in.";

  const transport = await transportFor(sender);
  try {
    for (const seed of seeds) {
      await transport.sendMail({
        from: sender.email,
        to: seed.email,
        subject,
        text: bodyText,
        html: textToHtml(bodyText),
        headers: { [PLACEMENT_HEADER]: token },
      });
    }
  } finally {
    transport.close();
  }

  const details: PlacementDetails = {
    token,
    subject,
    seeds: seeds.map((seed) => ({ email: seed.email, placement: "missing" })),
  };
  const test = await db.deliverabilityTest.create({
    data: {
      workspaceId,
      accountId: sender.id,
      kind: "placement",
      score: 0,
      summary: `Probe sent to ${seeds.length} seed mailbox${seeds.length === 1 ? "" : "es"} — check back in a minute.`,
      details: JSON.stringify(details),
    },
  });
  return { testId: test.id, seeds: seeds.length };
}

/** Look in each seed mailbox for the probe and score inbox placement. */
export async function checkPlacementTest(
  workspaceId: string,
  testId: string
): Promise<{ score: number; summary: string } | { error: string }> {
  const test = await db.deliverabilityTest.findFirst({
    where: { id: testId, workspaceId, kind: "placement" },
  });
  if (!test) return { error: "Test not found." };

  let details: PlacementDetails;
  try {
    details = JSON.parse(test.details) as PlacementDetails;
  } catch {
    return { error: "This test's record is unreadable." };
  }

  const results: SeedResult[] = [];
  for (const seed of details.seeds) {
    const account = await db.emailAccount.findFirst({
      where: { workspaceId, email: seed.email },
    });
    if (!account) {
      results.push({ email: seed.email, placement: "missing" });
      continue;
    }
    const client = await imapClientFor(account);
    try {
      await client.connect();
      if (await tokenIn(client, "INBOX", details.token)) {
        results.push({ email: seed.email, placement: "inbox" });
      } else {
        const spamPath = await findSpamMailbox(client);
        const inSpam = spamPath ? await tokenIn(client, spamPath, details.token) : false;
        results.push({ email: seed.email, placement: inSpam ? "spam" : "missing" });
      }
    } catch (err) {
      console.error(`[placement] ${seed.email}:`, (err as Error).message);
      results.push({ email: seed.email, placement: "missing" });
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  const inbox = results.filter((r) => r.placement === "inbox").length;
  const spam = results.filter((r) => r.placement === "spam").length;
  const missing = results.filter((r) => r.placement === "missing").length;
  const score = results.length === 0 ? 0 : Math.round((inbox / results.length) * 100);
  const summary = `${inbox} inbox · ${spam} spam · ${missing} not delivered yet`;

  await db.deliverabilityTest.update({
    where: { id: test.id },
    data: {
      score,
      summary,
      details: JSON.stringify({ ...details, seeds: results, checkedAt: new Date().toISOString() }),
    },
  });
  return { score, summary };
}
