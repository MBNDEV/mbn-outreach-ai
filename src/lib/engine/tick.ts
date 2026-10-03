import "server-only";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { transportFor } from "@/lib/engine/transport";
import { renderTemplate, textToHtml, type LeadVars } from "@/lib/template";
import { clickLink, unsubscribeUrls } from "@/lib/tracking";

// One engine pass: for every active campaign, send due sequence emails while
// respecting the send window, per-campaign and per-account daily limits, and
// the configured gap between sends. Runs every minute via instrumentation.ts;
// each pass sends at most one email per campaign so gaps stay honest without
// needing a scheduler process.

function tzParts(tz: string, at: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  for (const part of format.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return parts;
}

function todayStr(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
}

/** The UTC instant at which the current day started in `tz`, so a "daily"
 *  campaign limit covers the same calendar day the per-account counters use
 *  rather than a rolling 24 hours. */
function startOfDayUtc(tz: string): Date {
  const now = new Date();
  const p = tzParts(tz, now);
  const wallClock = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  const offset = wallClock - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) - offset);
}

function inSendWindow(campaign: {
  timezone: string;
  sendDays: string;
  windowStart: number;
  windowEnd: number;
}): boolean {
  try {
    const p = tzParts(campaign.timezone, new Date());
    const hour = Number(p.hour) % 24;
    const dayNum = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday ?? "");
    const days = JSON.parse(campaign.sendDays) as number[];
    return days.includes(dayNum) && hour >= campaign.windowStart && hour < campaign.windowEnd;
  } catch {
    return false;
  }
}

function leadVars(lead: {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  customFields: string;
}): LeadVars {
  let custom: Record<string, string> = {};
  try {
    custom = JSON.parse(lead.customFields);
  } catch {}
  return {
    ...custom,
    email: lead.email,
    first_name: lead.firstName,
    last_name: lead.lastName,
    company: lead.company,
    title: lead.title,
  };
}

let ticking = false;

export async function runSendTick(): Promise<{ sent: number; errors: number }> {
  // A pass that outlives its 60s interval would otherwise overlap the next one
  // and both could claim the same due lead, sending it twice.
  if (ticking) return { sent: 0, errors: 0 };
  ticking = true;
  try {
    return await sendPass();
  } finally {
    ticking = false;
  }
}

async function sendPass(): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;

  const campaigns = await db.campaign.findMany({
    where: { status: "active" },
    include: {
      steps: { orderBy: { order: "asc" }, include: { variants: true } },
      accounts: { include: { account: true } },
    },
  });

  for (const campaign of campaigns) {
    try {
      if (!inSendWindow(campaign)) continue;
      if (campaign.steps.length === 0) continue;

      const today = todayStr(campaign.timezone);

      const sentToday = await db.message.count({
        where: {
          campaignId: campaign.id,
          direction: "out",
          sentAt: { gte: startOfDayUtc(campaign.timezone) },
        },
      });
      if (sentToday >= campaign.dailyLimit) continue;

      // Gap between sends (with jitter) — skip the campaign until the gap has
      // elapsed since its most recent send.
      const lastMessage = await db.message.findFirst({
        where: { campaignId: campaign.id, direction: "out" },
        orderBy: { sentAt: "desc" },
      });
      if (lastMessage) {
        const gapMs = (campaign.gapMinutes + Math.random() * campaign.gapJitter) * 60_000;
        if (Date.now() - lastMessage.sentAt.getTime() < gapMs) continue;
      }

      // Spread volume across mailboxes least-used-first, so a second account
      // starts warming instead of idling until the first hits its ceiling.
      const sender = campaign.accounts
        .map((ca) => ca.account)
        .filter((account) => account.status === "connected")
        .map((account) => ({
          account,
          used: account.sentTodayDate === today ? account.sentToday : 0,
        }))
        .filter(({ account, used }) => used < account.dailyLimit)
        .sort((a, b) => a.used - b.used)[0]?.account;
      if (!sender) continue;

      // Next due lead.
      const due = await db.campaignLead.findFirst({
        where: {
          campaignId: campaign.id,
          status: { in: ["pending", "in_sequence"] },
          OR: [{ nextSendAt: null }, { nextSendAt: { lte: new Date() } }],
        },
        orderBy: { createdAt: "asc" },
        include: { lead: true },
      });
      if (!due) continue;

      const unsubscribed = await db.unsubscribe.findUnique({
        where: {
          workspaceId_email: {
            workspaceId: campaign.workspaceId,
            email: due.lead.email,
          },
        },
      });
      if (unsubscribed) {
        await db.campaignLead.update({
          where: { id: due.id },
          data: { status: "unsubscribed", statusNote: "On unsubscribe list" },
        });
        continue;
      }

      const blocked = await db.blocklistEntry.findFirst({
        where: {
          workspaceId: campaign.workspaceId,
          value: { in: [due.lead.email, due.lead.email.split("@")[1] ?? ""] },
        },
      });
      if (blocked) {
        await db.campaignLead.update({
          where: { id: due.id },
          data: { status: "stopped", statusNote: `Blocklisted (${blocked.value})` },
        });
        continue;
      }

      const step = campaign.steps[due.currentStep];
      if (!step) {
        await db.campaignLead.update({
          where: { id: due.id },
          data: { status: "completed" },
        });
        continue;
      }
      const variants = step.variants.filter((v) => v.enabled && (v.subject || v.body));
      if (variants.length === 0) continue;
      const variant = variants[Math.floor(Math.random() * variants.length)];

      // An SMS step runs the same gate as email — window, gap, stop rules — and
      // then hands off to the texting path, which applies its own consent and
      // quiet-hour checks before anything leaves.
      if (step.channel === "sms") {
        const { sendLeadSms } = await import("@/lib/twilio/send");
        const body = renderTemplate(variant.body, leadVars(due.lead));
        const result = await sendLeadSms({
          workspaceId: campaign.workspaceId,
          leadId: due.lead.id,
          body,
          timezone: campaign.timezone,
          campaignId: campaign.id,
          campaignLeadId: due.id,
          stepId: step.id,
        });

        if (!result.ok) {
          // A refusal is about this lead or this moment, not the campaign: park
          // the lead with the reason and let the next pass serve someone else.
          const retryable = result.reason.includes("texting hours");
          await db.campaignLead.update({
            where: { id: due.id },
            data: retryable
              ? { nextSendAt: new Date(Date.now() + 3_600_000), statusNote: result.reason }
              : { status: "stopped", statusNote: result.reason },
          });
          continue;
        }

        const isLastSmsStep = due.currentStep + 1 >= campaign.steps.length;
        const nextSmsStep = campaign.steps[due.currentStep + 1];
        await db.campaignLead.update({
          where: { id: due.id },
          data: isLastSmsStep
            ? { status: "completed", currentStep: due.currentStep + 1, nextSendAt: null }
            : {
                status: "in_sequence",
                currentStep: due.currentStep + 1,
                nextSendAt: new Date(Date.now() + (nextSmsStep?.waitDays ?? 1) * 86400_000),
              },
        });
        sent += 1;
        continue;
      }

      // Follow-ups belong in the same conversation: reuse the opening subject
      // with Re: and carry the RFC 5322 references mail clients group by.
      const priorTouches =
        due.currentStep > 0
          ? await db.message.findMany({
              where: { campaignLeadId: due.id, direction: "out" },
              orderBy: { sentAt: "asc" },
              select: { subject: true, messageId: true },
            })
          : [];
      const firstTouch = priorTouches[0];
      const previousMessageId = priorTouches[priorTouches.length - 1]?.messageId || "";

      const vars = leadVars(due.lead);
      const renderedSubject = renderTemplate(variant.subject, vars).trim();
      const threadSubject = firstTouch?.subject
        ? firstTouch.subject.startsWith("Re:")
          ? firstTouch.subject
          : `Re: ${firstTouch.subject}`
        : "";
      const subject = renderedSubject || threadSubject || "(no subject)";
      const bodyText = renderTemplate(variant.body, vars);

      const token = crypto.randomBytes(16).toString("hex");
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      const unsubscribe = unsubscribeUrls(appUrl, token);

      let html = textToHtml(
        bodyText,
        campaign.trackClicks ? (url) => clickLink(appUrl, token, url) : undefined
      );
      if (campaign.unsubscribeLink) {
        html += `<p style="margin-top:2em;font-size:12px;color:#94a3b8"><a href="${unsubscribe.page}" style="color:#94a3b8">Unsubscribe</a></p>`;
      }
      if (campaign.trackOpens) {
        html += `<img src="${appUrl}/api/t/o/${token}" width="1" height="1" alt="" style="display:none"/>`;
      }

      const fromName = [sender.senderFirstName, sender.senderLastName]
        .filter(Boolean)
        .join(" ");
      const references = priorTouches
        .map((m) => m.messageId)
        .filter((id, i, all) => id && all.indexOf(id) === i);
      const transport = await transportFor(sender);
      let sentMessageId = "";
      try {
        const info = await transport.sendMail({
          from: fromName ? `"${fromName}" <${sender.email}>` : sender.email,
          to: due.lead.email,
          subject,
          text: bodyText,
          html,
          inReplyTo: previousMessageId || undefined,
          references: references.length ? references : undefined,
          headers: campaign.unsubscribeLink
            ? {
                "List-Unsubscribe": `<${unsubscribe.oneClick}>, <${unsubscribe.page}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              }
            : undefined,
        });
        sentMessageId = info.messageId ?? "";
      } finally {
        transport.close();
      }

      const isLastStep = due.currentStep + 1 >= campaign.steps.length;
      const nextStep = campaign.steps[due.currentStep + 1];

      await db.$transaction([
        db.message.create({
          data: {
            workspaceId: campaign.workspaceId,
            campaignId: campaign.id,
            campaignLeadId: due.id,
            accountId: sender.id,
            stepId: step.id,
            variantId: variant.id,
            toEmail: due.lead.email,
            fromEmail: sender.email,
            subject,
            bodyText,
            messageId: sentMessageId,
            inReplyTo: previousMessageId,
            trackingToken: token,
          },
        }),
        db.campaignLead.update({
          where: { id: due.id },
          data: isLastStep
            ? { status: "completed", currentStep: due.currentStep + 1, nextSendAt: null }
            : {
                status: "in_sequence",
                currentStep: due.currentStep + 1,
                nextSendAt: new Date(Date.now() + (nextStep?.waitDays ?? 1) * 86400_000),
              },
        }),
        db.emailAccount.update({
          where: { id: sender.id },
          data:
            sender.sentTodayDate === today
              ? { sentToday: { increment: 1 } }
              : { sentToday: 1, sentTodayDate: today },
        }),
      ]);
      sent += 1;
    } catch (err) {
      errors += 1;
      console.error(`[engine] campaign ${campaign.id}:`, (err as Error).message);
    }
  }
  return { sent, errors };
}
