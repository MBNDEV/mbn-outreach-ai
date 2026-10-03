"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";

async function ownedOpportunity(id: string) {
  const { workspace } = await requireWorkspace();
  const opp = await db.opportunity.findUnique({ where: { id } });
  if (!opp || opp.workspaceId !== workspace.id) throw new Error("Not found.");
  return { opp, workspace };
}

export async function createOpportunityAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim().toLowerCase();
  if (!name) return;
  await db.opportunity.create({
    data: {
      workspaceId: workspace.id,
      name,
      contactEmail,
      value: Math.max(0, Number(formData.get("value") ?? 0) || 0),
      stage: "interested",
    },
  });
  revalidatePath("/crm");
}

export async function updateOpportunityAction(formData: FormData): Promise<void> {
  const { opp } = await ownedOpportunity(String(formData.get("id") ?? ""));
  const stage = String(formData.get("stage") ?? opp.stage);
  const valid = ["interested", "meeting_booked", "meeting_completed", "won", "lost"];
  await db.opportunity.update({
    where: { id: opp.id },
    data: {
      stage: valid.includes(stage) ? stage : opp.stage,
      value:
        formData.get("value") !== null
          ? Math.max(0, Number(formData.get("value")) || 0)
          : opp.value,
    },
  });
  revalidatePath("/crm");
}

export async function deleteOpportunityAction(formData: FormData): Promise<void> {
  const { opp } = await ownedOpportunity(String(formData.get("id") ?? ""));
  await db.opportunity.delete({ where: { id: opp.id } });
  revalidatePath("/crm");
}
