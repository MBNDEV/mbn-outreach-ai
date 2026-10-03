"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { requireWorkspace, requireRole } from "@/lib/auth";
import { planLimits } from "@/lib/plans";
import type { FormState } from "@/lib/actions/auth";

async function ownedCampaign(campaignId: string) {
  const { workspace, role } = await requireWorkspace();
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.workspaceId !== workspace.id) {
    throw new Error("Campaign not found.");
  }
  return { campaign, workspace, role };
}

export async function createCampaignAction(): Promise<void> {
  const { workspace } = await requireRole("member");
  const campaign = await db.campaign.create({
    data: {
      workspaceId: workspace.id,
      name: "Untitled Campaign",
      steps: {
        create: [{ order: 0, waitDays: 0, variants: { create: [{ label: "A" }] } }],
      },
    },
  });
  redirect(`/campaigns/${campaign.id}/editor`);
}

export async function renameCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const { campaign } = await ownedCampaign(id);
  if (name) {
    await db.campaign.update({ where: { id: campaign.id }, data: { name } });
  }
  revalidatePath(`/campaigns/${id}`, "layout");
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  await requireRole("admin");
  const { campaign } = await ownedCampaign(id);
  await db.campaign.delete({ where: { id: campaign.id } });
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

export interface LaunchState extends FormState {
  ok?: boolean;
}

export async function setCampaignStatusAction(
  _prev: LaunchState,
  formData: FormData
): Promise<LaunchState> {
  const id = String(formData.get("id") ?? "");
  const target = String(formData.get("status") ?? "");
  const { campaign } = await ownedCampaign(id);
  if (!["active", "paused"].includes(target)) return { error: "Invalid status." };

  if (target === "active") {
    const [steps, accounts, leads] = await Promise.all([
      db.sequenceStep.count({ where: { campaignId: id } }),
      db.campaignAccount.count({ where: { campaignId: id } }),
      db.campaignLead.count({ where: { campaignId: id } }),
    ]);
    const hasContent = await db.variant.findFirst({
      where: { step: { campaignId: id }, enabled: true, NOT: { body: "" } },
    });
    if (steps === 0 || !hasContent) return { error: "Add at least one step with copy first." };
    if (accounts === 0) return { error: "Pick a sending account in Settings first." };
    if (leads === 0) return { error: "Add leads before launching." };
  }

  await db.campaign.update({ where: { id: campaign.id }, data: { status: target } });
  revalidatePath(`/campaigns/${id}`, "layout");
  return { ok: true };
}

// ---- Sequence editing -------------------------------------------------------

export interface SequencePayload {
  steps: Array<{
    waitDays: number;
    channel?: string;
    variants: Array<{ label: string; subject: string; body: string; enabled: boolean }>;
  }>;
}

export async function saveSequenceAction(
  campaignId: string,
  payload: SequencePayload
): Promise<{ error?: string }> {
  try {
    const { campaign } = await ownedCampaign(campaignId);
    if (payload.steps.length === 0) return { error: "A sequence needs at least one step." };
    if (payload.steps.length > 20) return { error: "Max 20 steps." };

    const existingSteps = await db.sequenceStep.findMany({
      where: { campaignId: campaign.id },
      orderBy: { order: "asc" },
      include: { variants: true },
    });

    // Steps and variants are updated in place, matched by position and label:
    // sent messages point at these rows for per-step/per-variant analytics, and
    // deleting them nulls those references (SetNull), zeroing the history.
    await db.$transaction(async (tx) => {
      for (const [i, step] of payload.steps.entries()) {
        const waitDays = Math.max(0, Math.min(90, Math.round(step.waitDays) || 0));
        const channel = step.channel === "sms" ? "sms" : "email";
        const variants = step.variants.slice(0, 5).map((v, vi) => ({
          label: String.fromCharCode(65 + vi),
          subject: v.subject.slice(0, 500),
          body: v.body.slice(0, 20_000),
          enabled: v.enabled,
        }));

        const existing = existingSteps[i];
        if (!existing) {
          await tx.sequenceStep.create({
            data: {
              campaignId: campaign.id,
              order: i,
              waitDays,
              channel,
              variants: { create: variants },
            },
          });
          continue;
        }

        await tx.sequenceStep.update({
          where: { id: existing.id },
          data: { order: i, waitDays, channel },
        });
        for (const variant of variants) {
          const prior = existing.variants.find((v) => v.label === variant.label);
          if (prior) {
            await tx.variant.update({ where: { id: prior.id }, data: variant });
          } else {
            await tx.variant.create({ data: { stepId: existing.id, ...variant } });
          }
        }
        const dropped = existing.variants.filter(
          (v) => !variants.some((keep) => keep.label === v.label)
        );
        if (dropped.length > 0) {
          await tx.variant.deleteMany({ where: { id: { in: dropped.map((v) => v.id) } } });
        }
      }

      const removedSteps = existingSteps.slice(payload.steps.length);
      if (removedSteps.length > 0) {
        await tx.sequenceStep.deleteMany({
          where: { id: { in: removedSteps.map((s) => s.id) } },
        });
      }
    });
    revalidatePath(`/campaigns/${campaignId}/editor`);
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export interface GenerateState {
  error?: string;
  steps?: SequencePayload["steps"];
}

export async function generateSequenceAiAction(
  campaignId: string,
  input: { business: string; offer: string; audience: string; stepCount: number }
): Promise<GenerateState> {
  try {
    await ownedCampaign(campaignId);
    const { aiAvailable, generateSequence } = await import("@/lib/ai");
    if (!aiAvailable()) {
      return { error: "Set ANTHROPIC_API_KEY in .env to enable AI generation." };
    }
    const generated = await generateSequence(input);
    return {
      steps: generated.steps.map((s) => ({
        waitDays: s.waitDays,
        variants: [{ label: "A", subject: s.subject, body: s.body, enabled: true }],
      })),
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ---- Settings ---------------------------------------------------------------

export async function saveCampaignSettingsAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  const { campaign, workspace } = await ownedCampaign(id);
  const limits = planLimits(workspace.plan);

  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => formData.get(`day${d}`) === "on");
  const windowStart = Math.min(23, Math.max(0, Number(formData.get("windowStart") ?? 9)));
  const windowEnd = Math.min(24, Math.max(windowStart + 1, Number(formData.get("windowEnd") ?? 17)));
  const accountIds = formData.getAll("accountIds").map(String);

  const validAccounts = await db.emailAccount.findMany({
    where: { id: { in: accountIds }, workspaceId: workspace.id },
    select: { id: true },
  });

  await db.$transaction([
    db.campaign.update({
      where: { id: campaign.id },
      data: {
        timezone: String(formData.get("timezone") ?? campaign.timezone),
        sendDays: JSON.stringify(days.length ? days : [1, 2, 3, 4, 5]),
        windowStart,
        windowEnd,
        dailyLimit: Math.min(
          Number(formData.get("dailyLimit") ?? campaign.dailyLimit) || campaign.dailyLimit,
          limits.maxDailyEmailsPerAccount * Math.max(1, validAccounts.length)
        ),
        gapMinutes: Math.max(1, Number(formData.get("gapMinutes") ?? campaign.gapMinutes) || 1),
        gapJitter: Math.max(0, Number(formData.get("gapJitter") ?? campaign.gapJitter) || 0),
        trackOpens: formData.get("trackOpens") === "on",
        trackClicks: formData.get("trackClicks") === "on",
        stopOnReply: formData.get("stopOnReply") === "on",
        unsubscribeLink: formData.get("unsubscribeLink") === "on",
      },
    }),
    db.campaignAccount.deleteMany({ where: { campaignId: campaign.id } }),
    ...validAccounts.map((a) =>
      db.campaignAccount.create({ data: { campaignId: campaign.id, accountId: a.id } })
    ),
  ]);
  revalidatePath(`/campaigns/${id}/settings`);
  return {};
}

// ---- Leads ------------------------------------------------------------------

export interface LeadImportState extends FormState {
  imported?: number;
  skipped?: number;
}

interface LeadRow {
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  [key: string]: string | undefined;
}

const CORE_FIELDS = new Set(["email", "first_name", "last_name", "company", "title"]);

async function upsertLeads(
  workspaceId: string,
  campaignId: string,
  rows: LeadRow[]
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      skipped += 1;
      continue;
    }
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!CORE_FIELDS.has(k) && v) custom[k] = v;
    }
    const lead = await db.lead.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: {
        workspaceId,
        email,
        firstName: row.first_name?.trim() ?? "",
        lastName: row.last_name?.trim() ?? "",
        company: row.company?.trim() ?? "",
        title: row.title?.trim() ?? "",
        customFields: JSON.stringify(custom),
      },
      update: {
        firstName: row.first_name?.trim() || undefined,
        lastName: row.last_name?.trim() || undefined,
        company: row.company?.trim() || undefined,
        title: row.title?.trim() || undefined,
      },
    });
    try {
      await db.campaignLead.create({ data: { campaignId, leadId: lead.id } });
      imported += 1;
    } catch {
      skipped += 1; // already in this campaign
    }
  }
  return { imported, skipped };
}

export async function importLeadsCsvAction(
  _prev: LeadImportState,
  formData: FormData
): Promise<LeadImportState> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const { campaign, workspace } = await ownedCampaign(campaignId);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  const parsed = Papa.parse<LeadRow>(await file.text(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  if (parsed.data.length === 0) return { error: "No rows found in that CSV." };
  const result = await upsertLeads(workspace.id, campaign.id, parsed.data);
  revalidatePath(`/campaigns/${campaignId}/leads`);
  return result;
}

export async function addLeadsManualAction(
  _prev: LeadImportState,
  formData: FormData
): Promise<LeadImportState> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const { campaign, workspace } = await ownedCampaign(campaignId);
  const raw = String(formData.get("emails") ?? "");
  const rows: LeadRow[] = raw
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
  if (rows.length === 0) return { error: "Paste at least one email address." };
  const result = await upsertLeads(workspace.id, campaign.id, rows);
  revalidatePath(`/campaigns/${campaignId}/leads`);
  return result;
}

export async function removeCampaignLeadAction(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const id = String(formData.get("id") ?? "");
  await ownedCampaign(campaignId);
  await db.campaignLead.deleteMany({ where: { id, campaignId } });
  revalidatePath(`/campaigns/${campaignId}/leads`);
}
