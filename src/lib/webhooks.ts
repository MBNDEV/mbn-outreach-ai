import "server-only";
import crypto from "node:crypto";
import { db } from "@/lib/db";

export type WebhookEvent =
  | "reply_received"
  | "bounce_received"
  | "lead_unsubscribed"
  | "campaign_completed";

export const WEBHOOK_EVENTS: { id: WebhookEvent; label: string }[] = [
  { id: "reply_received", label: "Reply received" },
  { id: "bounce_received", label: "Bounce received" },
  { id: "lead_unsubscribed", label: "Lead unsubscribed" },
  { id: "campaign_completed", label: "Campaign completed" },
];

/** Fire-and-forget delivery with an HMAC signature header; failures are
 *  logged, not retried (a delivery queue is a later-phase concern). */
export async function dispatchWebhooks(
  workspaceId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const hooks = await db.webhook.findMany({ where: { workspaceId, enabled: true } });
  const matching = hooks.filter((h) => {
    try {
      return (JSON.parse(h.events) as string[]).includes(event);
    } catch {
      return false;
    }
  });
  if (matching.length === 0) return;

  const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
  await Promise.allSettled(
    matching.map(async (hook) => {
      const signature = crypto
        .createHmac("sha256", hook.secret || "unsigned")
        .update(body)
        .digest("hex");
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Event": event,
          "X-Webhook-Signature": signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) console.error(`[webhook] ${hook.url} -> ${res.status}`);
    })
  );
}
