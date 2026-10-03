import "server-only";
import { db } from "@/lib/db";

// The rules that decide whether a text may go out at all. SMS regulation is
// unforgiving and carriers are quick to kill a number, so these are enforced in
// code rather than left to whoever writes the sequence.

/** Keywords carriers require to work, whatever the sender wants. */
const OPT_OUT_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "optout"];
const HELP_WORDS = ["help", "info"];

export function isOptOut(body: string): boolean {
  const word = body.trim().toLowerCase().replace(/[^a-z]/g, "");
  return OPT_OUT_WORDS.includes(word);
}

export function isHelpRequest(body: string): boolean {
  const word = body.trim().toLowerCase().replace(/[^a-z]/g, "");
  return HELP_WORDS.includes(word);
}

/** Texting outside daytime hours is the fastest way to earn complaints. */
export const QUIET_START_HOUR = 8;
export const QUIET_END_HOUR = 21;

export function withinTextingHours(timezone: string, at = new Date()): boolean {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        hour12: false,
      }).format(at)
    );
    const normalized = hour % 24;
    return normalized >= QUIET_START_HOUR && normalized < QUIET_END_HOUR;
  } catch {
    // An unknown timezone must not become a licence to text at random hours.
    return false;
  }
}

export interface SmsGate {
  allowed: boolean;
  reason: string;
}

/**
 * Whether this lead may be texted right now. Ordered cheapest-first, and every
 * refusal carries a reason the UI can show instead of failing silently.
 */
export async function canTextLead(input: {
  workspaceId: string;
  lead: { id: string; phone: string; smsConsent: string; smsOptOutAt: Date | null };
  timezone: string;
}): Promise<SmsGate> {
  const phone = input.lead.phone.trim();
  if (!phone) return { allowed: false, reason: "No phone number on this lead." };
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    return {
      allowed: false,
      reason: `"${phone}" is not in E.164 form (e.g. +14805550123).`,
    };
  }
  if (input.lead.smsOptOutAt) {
    return { allowed: false, reason: "This lead replied STOP and must not be texted again." };
  }
  if (!input.lead.smsConsent) {
    return {
      allowed: false,
      reason: "No SMS consent recorded for this lead.",
    };
  }
  if (!withinTextingHours(input.timezone)) {
    return {
      allowed: false,
      reason: `Outside texting hours (${QUIET_START_HOUR}:00–${QUIET_END_HOUR}:00 ${input.timezone}).`,
    };
  }

  const blocked = await db.blocklistEntry.findFirst({
    where: { workspaceId: input.workspaceId, value: phone },
  });
  if (blocked) return { allowed: false, reason: "This number is blocklisted." };

  return { allowed: true, reason: "" };
}

/** Record an opt-out everywhere it needs to hold: the lead, the blocklist, and
 *  any campaign still holding them in a sequence. */
export async function recordOptOut(input: {
  workspaceId: string;
  leadId?: string | null;
  phone: string;
}): Promise<void> {
  if (input.leadId) {
    await db.lead.update({
      where: { id: input.leadId },
      data: { smsOptOutAt: new Date(), smsConsent: "" },
    });
    await db.campaignLead.updateMany({
      where: { leadId: input.leadId, status: { in: ["pending", "in_sequence"] } },
      data: { status: "unsubscribed", statusNote: "Replied STOP to an SMS", nextSendAt: null },
    });
  }
  await db.blocklistEntry
    .create({ data: { workspaceId: input.workspaceId, value: input.phone } })
    .catch(() => {}); // already blocked
}

/** What a call attempt can have come to. */
export const CALL_OUTCOMES = [
  "connected",
  "no_answer",
  "voicemail",
  "meeting_booked",
  "not_interested",
  "wrong_number",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export function isCallOutcome(value: string): value is CallOutcome {
  return (CALL_OUTCOMES as readonly string[]).includes(value);
}

export function todayKey(at = new Date()): string {
  return at.toISOString().slice(0, 10);
}
