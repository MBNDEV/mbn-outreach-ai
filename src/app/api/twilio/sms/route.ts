import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateSignature } from "@/lib/twilio/client";
import { isOptOut, isHelpRequest, recordOptOut } from "@/lib/twilio/rules";
import { dispatchWebhooks } from "@/lib/webhooks";

// Inbound SMS from Twilio.
//
// This endpoint is public, so the signature check is the whole security model:
// a forged request could fake a STOP, or fake a reply that halts a campaign.
// Anything unsigned or mis-signed is rejected before a single row is written.

function twiml(message?: string): NextResponse {
  const body = message
    ? `<Response><Message>${message}</Message></Response>`
    : "<Response/>";
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value;

  // Twilio signs the URL it was configured with. Behind a proxy the forwarded
  // host is what it saw, so prefer that over the rewritten local one.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const url = forwardedHost
    ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${forwardedHost}${new URL(req.url).pathname}`
    : req.url;

  const valid = validateSignature({
    url,
    params,
    signature: req.headers.get("x-twilio-signature") ?? "",
  });
  if (!valid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const from = (params.From ?? "").trim();
  const to = (params.To ?? "").trim();
  const body = params.Body ?? "";
  if (!from || !to) {
    return NextResponse.json({ error: "Missing From/To" }, { status: 400 });
  }

  // The receiving number tells us which workspace this belongs to.
  const number = await db.phoneNumber.findFirst({ where: { number: to } });
  if (!number) {
    // Not ours: acknowledge so Twilio stops retrying, but record nothing.
    return twiml();
  }

  const lead = await db.lead.findFirst({
    where: { workspaceId: number.workspaceId, phone: from },
  });

  await db.smsMessage.create({
    data: {
      workspaceId: number.workspaceId,
      numberId: number.id,
      leadId: lead?.id ?? null,
      direction: "in",
      toNumber: to,
      fromNumber: from,
      body,
      status: "received",
      providerSid: params.MessageSid ?? "",
    },
  });

  if (isOptOut(body)) {
    await recordOptOut({ workspaceId: number.workspaceId, leadId: lead?.id, phone: from });
    // Twilio's Advanced Opt-Out may already answer; a plain account does not,
    // and confirming an opt-out is a compliance expectation either way.
    return twiml("You're unsubscribed and won't receive further messages.");
  }

  if (isHelpRequest(body)) {
    return twiml("Reply STOP to unsubscribe at any time.");
  }

  // A real reply lands in the Unibox next to email, and stops the sequence for
  // the same reason a mail reply does.
  const thread = await db.thread.findFirst({
    where: { workspaceId: number.workspaceId, contactEmail: from, done: false },
    orderBy: { lastMessageAt: "desc" },
  });
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 140);
  if (thread) {
    await db.thread.update({
      where: { id: thread.id },
      data: { snippet, unread: true, lastMessageAt: new Date() },
    });
  } else {
    await db.thread.create({
      data: {
        workspaceId: number.workspaceId,
        contactEmail: from,
        subject: "SMS conversation",
        snippet,
        leadId: lead?.id ?? null,
        label: "lead",
        lastMessageAt: new Date(),
      },
    });
  }

  if (lead) {
    await db.campaignLead.updateMany({
      where: { leadId: lead.id, status: { in: ["pending", "in_sequence"] } },
      data: { status: "replied", statusNote: "Replied by SMS", nextSendAt: null },
    });
  }

  await dispatchWebhooks(number.workspaceId, "reply_received", {
    channel: "sms",
    from,
    body: snippet,
  });

  return twiml();
}
