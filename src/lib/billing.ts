import "server-only";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { PLANS, type PlanId } from "@/lib/plans";

// Billing is env-gated the way the AI layer is: without STRIPE_SECRET_KEY the
// app runs and the billing UI explains what to configure. Prices live in env so
// the same build works against test and live Stripe accounts.

export function billingAvailable(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Billing is not configured: set STRIPE_SECRET_KEY.");
  return new Stripe(key);
}

/** Recurring price per paid plan. Free has no price and needs no checkout. */
export function planPriceId(plan: PlanId): string | null {
  const ids: Record<PlanId, string | undefined> = {
    free: undefined,
    starter: process.env.STRIPE_PRICE_STARTER,
    scale: process.env.STRIPE_PRICE_SCALE,
    agency: process.env.STRIPE_PRICE_AGENCY,
  };
  return ids[plan] ?? null;
}

export function planForPriceId(priceId: string): PlanId | null {
  const found = (Object.keys(PLANS) as PlanId[]).find((plan) => planPriceId(plan) === priceId);
  return found ?? null;
}

export const CREDIT_PACK_SIZE = 1000;

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

async function customerIdFor(workspace: {
  id: string;
  name: string;
  stripeCustomerId: string;
}): Promise<string> {
  if (workspace.stripeCustomerId) return workspace.stripeCustomerId;
  const customer = await stripe().customers.create({
    name: workspace.name,
    metadata: { workspaceId: workspace.id },
  });
  await db.workspace.update({
    where: { id: workspace.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

export async function planCheckoutUrl(
  workspace: { id: string; name: string; stripeCustomerId: string },
  plan: PlanId
): Promise<string> {
  const price = planPriceId(plan);
  if (!price) throw new Error(`No Stripe price configured for the ${plan} plan.`);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: await customerIdFor(workspace),
    line_items: [{ price, quantity: 1 }],
    success_url: `${appUrl()}/settings?billing=updated`,
    cancel_url: `${appUrl()}/settings?billing=cancelled`,
    metadata: { workspaceId: workspace.id, kind: "plan", plan },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function creditCheckoutUrl(
  workspace: { id: string; name: string; stripeCustomerId: string },
  packs: number
): Promise<string> {
  const price = process.env.STRIPE_PRICE_CREDITS;
  if (!price) throw new Error("No Stripe price configured for credit packs.");
  const quantity = Math.max(1, Math.min(100, Math.round(packs)));
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer: await customerIdFor(workspace),
    line_items: [{ price, quantity }],
    success_url: `${appUrl()}/leads?credits=added`,
    cancel_url: `${appUrl()}/settings?billing=cancelled`,
    metadata: {
      workspaceId: workspace.id,
      kind: "credits",
      credits: String(quantity * CREDIT_PACK_SIZE),
    },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function marketplaceCheckoutUrl(
  workspace: { id: string; name: string; stripeCustomerId: string },
  orderId: string,
  domainName: string,
  mailboxCount: number
): Promise<string> {
  const domainPrice = process.env.STRIPE_PRICE_DOMAIN;
  const mailboxPrice = process.env.STRIPE_PRICE_MAILBOX;
  if (!domainPrice || !mailboxPrice) {
    throw new Error(
      "Set STRIPE_PRICE_DOMAIN and STRIPE_PRICE_MAILBOX to sell domains and mailboxes."
    );
  }
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer: await customerIdFor(workspace),
    line_items: [
      { price: domainPrice, quantity: 1 },
      { price: mailboxPrice, quantity: Math.max(1, Math.min(10, mailboxCount)) },
    ],
    success_url: `${appUrl()}/marketplace?order=placed`,
    cancel_url: `${appUrl()}/marketplace?order=cancelled`,
    metadata: { workspaceId: workspace.id, kind: "marketplace", orderId, domainName },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function billingPortalUrl(customerId: string): Promise<string> {
  const session = await stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/settings`,
  });
  return session.url;
}

/** Verify and parse a webhook delivery. Signature checking is mandatory: the
 *  endpoint is public and its payloads grant plan access and credits. */
export function parseWebhook(payload: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error("Set STRIPE_WEBHOOK_SECRET to accept Stripe webhooks.");
  return stripe().webhooks.constructEvent(payload, signature, secret);
}

async function grantCredits(workspaceId: string, credits: number, reason: string): Promise<void> {
  if (credits <= 0) return;
  await db.$transaction([
    db.workspace.update({
      where: { id: workspaceId },
      data: { credits: { increment: credits } },
    }),
    db.creditLedger.create({ data: { workspaceId, delta: credits, reason } }),
  ]);
}

export async function applyWebhookEvent(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const workspaceId = session.metadata?.workspaceId;
      if (!workspaceId) return "ignored: no workspace in metadata";
      if (session.metadata?.kind === "marketplace") {
        const orderId = session.metadata.orderId ?? "";
        await db.marketplaceOrder.updateMany({
          where: { id: orderId, workspaceId },
          data: { status: "paid" },
        });
        // The tick would pick this up anyway; kicking it here means a customer
        // who just paid sees movement immediately.
        const { runProvisioningTick } = await import("@/lib/marketplace/provision");
        await runProvisioningTick();
        return `marketplace order ${orderId} paid`;
      }
      if (session.metadata?.kind === "credits") {
        await grantCredits(
          workspaceId,
          Number(session.metadata.credits ?? 0),
          `Credit pack purchase (${session.id})`
        );
        return `credits added to ${workspaceId}`;
      }
      const plan = session.metadata?.plan;
      if (plan && plan in PLANS) {
        await db.workspace.update({
          where: { id: workspaceId },
          data: {
            plan,
            planStatus: "active",
            stripeSubscriptionId:
              typeof session.subscription === "string" ? session.subscription : "",
          },
        });
        return `${workspaceId} moved to ${plan}`;
      }
      return "ignored: unknown checkout kind";
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object;
      const workspace = await db.workspace.findFirst({
        where: { stripeCustomerId: String(subscription.customer) },
      });
      if (!workspace) return "ignored: no workspace for customer";

      const priceId = subscription.items.data[0]?.price.id ?? "";
      const plan = planForPriceId(priceId);
      const ended = event.type === "customer.subscription.deleted" || subscription.status === "canceled";
      await db.workspace.update({
        where: { id: workspace.id },
        data: ended
          ? { plan: "free", planStatus: "canceled", stripeSubscriptionId: "" }
          : {
              ...(plan ? { plan } : {}),
              planStatus: subscription.status === "past_due" ? "past_due" : "active",
              stripeSubscriptionId: subscription.id,
            },
      });
      return `${workspace.id} subscription ${subscription.status}`;
    }

    default:
      return `ignored: ${event.type}`;
  }
}
