import { NextRequest, NextResponse } from "next/server";
import { parseWebhook, applyWebhookEvent, billingAvailable } from "@/lib/billing";

export async function POST(req: NextRequest) {
  if (!billingAvailable()) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }
  // The raw body is what the signature covers, so it must not be parsed first.
  const payload = await req.text();

  let result: string;
  try {
    result = await applyWebhookEvent(parseWebhook(payload, signature));
  } catch (err) {
    const message = (err as Error).message;
    console.error("[stripe] webhook rejected:", message);
    // 400 tells Stripe not to retry a payload we could never accept; a genuine
    // outage surfaces as a 500 from the throw above being logged and retried.
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ received: true, result });
}
