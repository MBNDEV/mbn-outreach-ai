"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWorkspace, requireRole } from "@/lib/auth";
import { twilioAvailable, listNumbers, placeCall } from "@/lib/twilio/client";
import { sendLeadSms } from "@/lib/twilio/send";
import { canTextLead, isCallOutcome } from "@/lib/twilio/rules";
import type { FormState } from "@/lib/actions/auth";

export async function addNumberAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { workspace } = await requireRole("admin");
    const number = String(formData.get("number") ?? "").trim();
    if (!/^\+[1-9]\d{6,14}$/.test(number)) {
      return { error: "Enter the number in E.164 form, e.g. +14805550123." };
    }
    await db.phoneNumber.create({
      data: {
        workspaceId: workspace.id,
        number,
        label: String(formData.get("label") ?? "").trim().slice(0, 60),
        dailySmsLimit: Math.max(1, Math.min(500, Number(formData.get("dailySmsLimit") ?? 50) || 50)),
      },
    });
    revalidatePath("/phone");
    return {};
  } catch (err) {
    const message = (err as Error).message;
    return {
      error: message.includes("Unique constraint")
        ? "That number is already in this workspace."
        : message,
    };
  }
}

/** Pull the numbers already on the Twilio account so they can be added without
 *  retyping — only possible when credentials exist. */
export async function importNumbersAction(
  _prev: FormState,
  _formData: FormData
): Promise<FormState> {
  try {
    const { workspace } = await requireRole("admin");
    if (!twilioAvailable()) {
      return { error: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to import numbers." };
    }
    const result = await listNumbers();
    if (!result.ok) return { error: result.error };

    let added = 0;
    for (const number of result.numbers) {
      if (!number.number) continue;
      await db.phoneNumber
        .create({
          data: {
            workspaceId: workspace.id,
            number: number.number,
            providerSid: number.sid,
            capabilities: JSON.stringify(number.capabilities),
            smsEnabled: number.capabilities.sms,
          },
        })
        .then(() => {
          added += 1;
        })
        .catch(() => {}); // already added
    }
    revalidatePath("/phone");
    return { error: added > 0 ? undefined : "No new numbers found on the account." };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function updateNumberAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  const number = await db.phoneNumber.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!number) return;
  await db.phoneNumber.update({
    where: { id: number.id },
    data: {
      smsEnabled: formData.get("smsEnabled") === "on",
      dailySmsLimit: Math.max(
        1,
        Math.min(500, Number(formData.get("dailySmsLimit") ?? number.dailySmsLimit) || number.dailySmsLimit)
      ),
    },
  });
  revalidatePath("/phone");
}

export async function removeNumberAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  await db.phoneNumber.deleteMany({
    where: { id: String(formData.get("id") ?? ""), workspaceId: workspace.id },
  });
  revalidatePath("/phone");
}

export interface LeadSmsState extends FormState {
  message?: string;
}

/** Record consent for a lead, with the phone number it applies to. */
export async function saveLeadPhoneAction(
  _prev: LeadSmsState,
  formData: FormData
): Promise<LeadSmsState> {
  try {
    const { workspace } = await requireWorkspace();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const phone = String(formData.get("phone") ?? "").trim();
    const consent = String(formData.get("consent") ?? "");
    if (!["", "explicit", "implied"].includes(consent)) return { error: "Invalid consent value." };

    const lead = await db.lead.findUnique({
      where: { workspaceId_email: { workspaceId: workspace.id, email } },
    });
    if (!lead) return { error: "No lead with that email in this workspace." };
    if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
      return { error: "Enter the number in E.164 form, e.g. +14805550123." };
    }

    await db.lead.update({
      where: { id: lead.id },
      // Recording consent never clears an opt-out: once someone says STOP that
      // decision outlives whatever a CSV says.
      data: { phone, smsConsent: lead.smsOptOutAt ? "" : consent },
    });
    revalidatePath("/phone");
    return {
      message: lead.smsOptOutAt
        ? "Saved, but this lead opted out previously and stays unsubscribed."
        : "Saved.",
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function sendTestSmsAction(
  _prev: LeadSmsState,
  formData: FormData
): Promise<LeadSmsState> {
  try {
    const { workspace } = await requireRole("admin");
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return { error: "Write the message first." };

    const lead = await db.lead.findUnique({
      where: { workspaceId_email: { workspaceId: workspace.id, email } },
    });
    if (!lead) return { error: "No lead with that email in this workspace." };

    const result = await sendLeadSms({
      workspaceId: workspace.id,
      leadId: lead.id,
      body,
      timezone: String(formData.get("timezone") ?? "America/Phoenix"),
    });
    revalidatePath("/phone");
    return result.ok ? { message: "Sent." } : { error: result.reason };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Why a given lead can or cannot be texted right now — shown before sending
 *  so the reason is visible rather than discovered on failure. */
export async function checkLeadTextableAction(
  _prev: LeadSmsState,
  formData: FormData
): Promise<LeadSmsState> {
  try {
    const { workspace } = await requireWorkspace();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const lead = await db.lead.findUnique({
      where: { workspaceId_email: { workspaceId: workspace.id, email } },
    });
    if (!lead) return { error: "No lead with that email in this workspace." };
    const gate = await canTextLead({
      workspaceId: workspace.id,
      lead,
      timezone: String(formData.get("timezone") ?? "America/Phoenix"),
    });
    return gate.allowed
      ? { message: `${lead.email} can be texted now.` }
      : { error: gate.reason };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function logCallAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { workspace } = await requireWorkspace();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const outcome = String(formData.get("outcome") ?? "");
    if (!isCallOutcome(outcome)) return { error: "Pick an outcome." };
    const lead = await db.lead.findUnique({
      where: { workspaceId_email: { workspaceId: workspace.id, email } },
    });
    if (!lead) return { error: "No lead with that email in this workspace." };

    const from = await db.phoneNumber.findFirst({ where: { workspaceId: workspace.id } });
    await db.callLog.create({
      data: {
        workspaceId: workspace.id,
        numberId: from?.id ?? null,
        leadId: lead.id,
        toNumber: lead.phone,
        fromNumber: from?.number ?? "",
        status: "logged",
        outcome,
        notes: String(formData.get("notes") ?? "").slice(0, 1000),
        durationSec: Math.max(0, Number(formData.get("durationSec") ?? 0) || 0),
      },
    });

    // A booked meeting is pipeline, so mirror it the way a positive reply would.
    if (outcome === "meeting_booked") {
      await db.opportunity
        .create({
          data: {
            workspaceId: workspace.id,
            contactEmail: lead.email,
            name: lead.company || lead.email,
            stage: "meeting_booked",
          },
        })
        .catch(() => {});
    }
    revalidatePath("/phone");
    revalidatePath("/crm");
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Dial the rep first, then bridge to the lead. Needs Twilio. */
export async function clickToCallAction(_prev: FormState, formData: FormData): Promise<FormState> {
  try {
    const { workspace } = await requireRole("admin");
    if (!twilioAvailable()) {
      return { error: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to place calls." };
    }
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const repNumber = String(formData.get("repNumber") ?? "").trim();
    if (!/^\+[1-9]\d{6,14}$/.test(repNumber)) {
      return { error: "Enter your own number in E.164 form so we can ring you first." };
    }
    const lead = await db.lead.findUnique({
      where: { workspaceId_email: { workspaceId: workspace.id, email } },
    });
    if (!lead?.phone) return { error: "That lead has no phone number." };

    const from = await db.phoneNumber.findFirst({ where: { workspaceId: workspace.id } });
    if (!from) return { error: "Add a number to call from first." };

    const result = await placeCall({ to: repNumber, from: from.number, bridgeTo: lead.phone });
    await db.callLog.create({
      data: {
        workspaceId: workspace.id,
        numberId: from.id,
        leadId: lead.id,
        toNumber: lead.phone,
        fromNumber: from.number,
        status: result.ok ? "queued" : "failed",
        notes: result.ok ? "Click-to-call: ringing you first." : result.error.slice(0, 300),
        providerSid: result.ok ? result.sid : "",
      },
    });
    revalidatePath("/phone");
    return result.ok ? {} : { error: result.error };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
