import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateSignature } from "@/lib/twilio/client";

// Delivery receipts. Same signature rule as inbound: without it anyone could
// mark a message delivered that never arrived.

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw)) params[key] = value;

  const forwardedHost = req.headers.get("x-forwarded-host");
  const url = forwardedHost
    ? `${req.headers.get("x-forwarded-proto") ?? "https"}://${forwardedHost}${new URL(req.url).pathname}`
    : req.url;

  if (
    !validateSignature({
      url,
      params,
      signature: req.headers.get("x-twilio-signature") ?? "",
    })
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const sid = params.MessageSid ?? params.SmsSid ?? "";
  const status = params.MessageStatus ?? params.SmsStatus ?? "";
  if (!sid || !status) return NextResponse.json({ ok: true });

  await db.smsMessage.updateMany({
    where: { providerSid: sid },
    data: {
      status,
      errorMessage: params.ErrorCode ? `Twilio error ${params.ErrorCode}` : "",
    },
  });

  return NextResponse.json({ ok: true });
}
