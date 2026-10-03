import "server-only";
import { db } from "@/lib/db";
import { dispatchWebhooks } from "@/lib/webhooks";

async function recipientOf(token: string) {
  const message = await db.message.findUnique({
    where: { trackingToken: token },
    select: { workspaceId: true, toEmail: true, campaignId: true, campaignLeadId: true },
  });
  if (!message) return null;
  const existing = await db.unsubscribe.findUnique({
    where: {
      workspaceId_email: { workspaceId: message.workspaceId, email: message.toEmail },
    },
  });
  return { message, alreadyDone: Boolean(existing) };
}

/** Who a tracked message went to, and whether they already opted out. */
export async function unsubscribeRecipient(
  token: string
): Promise<{ email: string; alreadyDone: boolean } | null> {
  const found = await recipientOf(token);
  return found && { email: found.message.toEmail, alreadyDone: found.alreadyDone };
}

/** Suppress the recipient of a tracked message. Idempotent, so a repeated
 *  one-click POST still reports success. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const found = await recipientOf(token);
  if (!found) return false;
  if (found.alreadyDone) return true;
  const { message } = found;

  await db.unsubscribe.create({
    data: { workspaceId: message.workspaceId, email: message.toEmail },
  });
  if (message.campaignLeadId) {
    await db.campaignLead.update({
      where: { id: message.campaignLeadId },
      data: { status: "unsubscribed", statusNote: "Clicked unsubscribe", nextSendAt: null },
    });
  }
  await dispatchWebhooks(message.workspaceId, "lead_unsubscribed", {
    email: message.toEmail,
    campaignId: message.campaignId,
  });
  return true;
}
