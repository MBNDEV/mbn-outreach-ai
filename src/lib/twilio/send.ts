import "server-only";
import { db } from "@/lib/db";
import { sendSms, twilioAvailable } from "@/lib/twilio/client";
import { canTextLead, todayKey } from "@/lib/twilio/rules";

// Sending one text, with the bookkeeping that has to happen around it: pick a
// number under its daily cap, check the lead may be texted at all, record the
// message before and after the provider call, and keep the counter honest.

export interface SmsSendResult {
  ok: boolean;
  reason: string;
  messageId?: string;
}

/** A number with SMS enabled that still has headroom today. */
export async function pickNumber(workspaceId: string) {
  const numbers = await db.phoneNumber.findMany({
    where: { workspaceId, smsEnabled: true },
    orderBy: { createdAt: "asc" },
  });
  const today = todayKey();
  return (
    numbers
      .map((number) => ({
        number,
        used: number.sentTodayDate === today ? number.sentToday : 0,
      }))
      .filter(({ number, used }) => used < number.dailySmsLimit)
      // Least-used first, so volume spreads rather than burning one number.
      .sort((a, b) => a.used - b.used)[0]?.number ?? null
  );
}

export async function sendLeadSms(input: {
  workspaceId: string;
  leadId: string;
  body: string;
  timezone: string;
  campaignId?: string | null;
  campaignLeadId?: string | null;
  stepId?: string | null;
}): Promise<SmsSendResult> {
  const lead = await db.lead.findFirst({
    where: { id: input.leadId, workspaceId: input.workspaceId },
  });
  if (!lead) return { ok: false, reason: "Lead not found." };

  const gate = await canTextLead({
    workspaceId: input.workspaceId,
    lead,
    timezone: input.timezone,
  });
  if (!gate.allowed) return { ok: false, reason: gate.reason };

  const number = await pickNumber(input.workspaceId);
  if (!number) {
    return { ok: false, reason: "No SMS-enabled number with capacity left today." };
  }
  if (!twilioAvailable()) {
    return { ok: false, reason: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to send texts." };
  }

  // Recorded before the provider call so a crash mid-send leaves a trace
  // rather than a silent gap.
  const message = await db.smsMessage.create({
    data: {
      workspaceId: input.workspaceId,
      numberId: number.id,
      leadId: lead.id,
      campaignId: input.campaignId ?? null,
      campaignLeadId: input.campaignLeadId ?? null,
      stepId: input.stepId ?? null,
      direction: "out",
      toNumber: lead.phone,
      fromNumber: number.number,
      body: input.body,
      status: "queued",
    },
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const result = await sendSms({
    to: lead.phone,
    from: number.number,
    body: input.body,
    statusCallback: `${appUrl}/api/twilio/status`,
  });

  if (!result.ok) {
    await db.smsMessage.update({
      where: { id: message.id },
      data: { status: "failed", errorMessage: result.error.slice(0, 300) },
    });
    return { ok: false, reason: result.error, messageId: message.id };
  }

  const today = todayKey();
  await db.$transaction([
    db.smsMessage.update({
      where: { id: message.id },
      data: { status: result.sms.status, providerSid: result.sms.sid },
    }),
    db.phoneNumber.update({
      where: { id: number.id },
      data:
        number.sentTodayDate === today
          ? { sentToday: { increment: 1 } }
          : { sentToday: 1, sentTodayDate: today },
    }),
  ]);

  return { ok: true, reason: "", messageId: message.id };
}
