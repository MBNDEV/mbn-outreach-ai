"use server";

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { db, icontains } from "@/lib/db";
import { requireWorkspace, requireRole } from "@/lib/auth";
import { spendCredits } from "@/lib/credits";
import { verifyEmail } from "@/lib/enrichment";
import type { FormState } from "@/lib/actions/auth";

export interface LeadsOpState extends FormState {
  message?: string;
}

export async function createListAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  if (name) {
    await db.leadList
      .create({ data: { workspaceId: workspace.id, name } })
      .catch(() => {}); // duplicate name
  }
  revalidatePath("/leads");
}

export async function importWorkspaceLeadsAction(
  _prev: LeadsOpState,
  formData: FormData
): Promise<LeadsOpState> {
  const { workspace } = await requireWorkspace();
  const file = formData.get("file");
  const requestedListId = String(formData.get("listId") ?? "");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };

  const list = requestedListId
    ? await db.leadList.findFirst({
        where: { id: requestedListId, workspaceId: workspace.id },
        select: { id: true },
      })
    : null;
  if (requestedListId && !list) return { error: "That list no longer exists." };
  const listId = list?.id ?? "";

  interface Row {
    email?: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    title?: string;
    [k: string]: string | undefined;
  }
  const parsed = Papa.parse<Row>(await file.text(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });

  let imported = 0;
  let skipped = 0;
  const core = new Set(["email", "first_name", "last_name", "company", "title"]);
  for (const row of parsed.data) {
    const email = row.email?.trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      skipped += 1;
      continue;
    }
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) if (!core.has(k) && v) custom[k] = v;
    const lead = await db.lead.upsert({
      where: { workspaceId_email: { workspaceId: workspace.id, email } },
      create: {
        workspaceId: workspace.id,
        email,
        firstName: row.first_name?.trim() ?? "",
        lastName: row.last_name?.trim() ?? "",
        company: row.company?.trim() ?? "",
        title: row.title?.trim() ?? "",
        customFields: JSON.stringify(custom),
      },
      update: {},
    });
    if (listId) {
      await db.leadListItem
        .create({ data: { listId, leadId: lead.id } })
        .catch(() => {});
    }
    imported += 1;
  }
  revalidatePath("/leads");
  return { message: `Imported ${imported} lead${imported === 1 ? "" : "s"}${skipped ? `, skipped ${skipped}` : ""}.` };
}

function selectionWhere(workspaceId: string, formData: FormData) {
  const q = String(formData.get("q") ?? "");
  const listId = String(formData.get("listId") ?? "");
  const selected = formData.getAll("leadIds").map(String);
  if (selected.length > 0) return { workspaceId, id: { in: selected } };
  return {
    workspaceId,
    ...(listId ? { listItems: { some: { listId } } } : {}),
    ...(q
      ? {
          OR: [
            { email: icontains(q) },
            { company: icontains(q) },
            { firstName: icontains(q) },
            { lastName: icontains(q) },
          ],
        }
      : {}),
  };
}

export async function verifyLeadsAction(
  _prev: LeadsOpState,
  formData: FormData
): Promise<LeadsOpState> {
  try {
    const { workspace } = await requireWorkspace();
    const where = selectionWhere(workspace.id, formData);
    const leads = await db.lead.findMany({ where, take: 500 });
    const unverified = leads.filter((l) => l.verifyStatus === "unverified");
    if (unverified.length === 0) return { message: "Nothing to verify in this selection." };

    // Charge per lead as it is verified, never for the whole selection up
    // front: a provider failure or an exhausted balance partway through would
    // otherwise bill for lookups that never happened.
    let valid = 0;
    let spent = 0;
    let ranOut = false;
    for (const lead of unverified) {
      try {
        await spendCredits(workspace.id, 1, `Email verification: ${lead.email}`);
      } catch {
        ranOut = true;
        break;
      }
      spent += 1;
      const status = await verifyEmail(lead.email);
      if (status === "valid") valid += 1;
      await db.lead.update({ where: { id: lead.id }, data: { verifyStatus: status } });
    }
    revalidatePath("/leads");
    if (spent === 0) return { error: "Not enough credits. Top up to continue." };
    return {
      message: `Verified ${spent}: ${valid} valid, ${spent - valid} risky/invalid. (${spent} credits)${
        ranOut ? ` Stopped early — out of credits with ${unverified.length - spent} left.` : ""
      }`,
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function pushToCampaignAction(
  _prev: LeadsOpState,
  formData: FormData
): Promise<LeadsOpState> {
  try {
    const { workspace } = await requireWorkspace();
    const campaignId = String(formData.get("campaignId") ?? "");
    const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.workspaceId !== workspace.id) {
      return { error: "Pick a campaign first." };
    }
    const where = selectionWhere(workspace.id, formData);
    const leads = await db.lead.findMany({ where, select: { id: true }, take: 2000 });
    let added = 0;
    for (const lead of leads) {
      try {
        await db.campaignLead.create({ data: { campaignId, leadId: lead.id } });
        added += 1;
      } catch {
        // already in campaign
      }
    }
    revalidatePath("/leads");
    return { message: `Added ${added} of ${leads.length} to "${campaign.name}".` };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function deleteLeadAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  await db.lead.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/leads");
}

// ---- Blocklist --------------------------------------------------------------

export async function addBlocklistAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const value = String(formData.get("value") ?? "").trim().toLowerCase();
  if (value) {
    await db.blocklistEntry
      .create({ data: { workspaceId: workspace.id, value } })
      .catch(() => {});
  }
  revalidatePath("/settings");
}

export async function removeBlocklistAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  await db.blocklistEntry.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/settings");
}
