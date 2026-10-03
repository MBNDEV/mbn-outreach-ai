"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireRole, requireWorkspace, setActiveWorkspace } from "@/lib/auth";
import type { FormState } from "@/lib/actions/auth";

export interface SubWorkspaceState extends FormState {
  created?: string;
}

/** Sub-workspaces are an Agency-plan feature: one client per workspace, each
 *  with its own mailboxes, campaigns and leads, all billed to the parent. */
export async function createSubWorkspaceAction(
  _prev: SubWorkspaceState,
  formData: FormData
): Promise<SubWorkspaceState> {
  try {
    const { workspace, user } = await requireRole("owner");
    if (workspace.plan !== "agency") {
      return { error: "Sub-workspaces are part of the Agency plan." };
    }
    if (workspace.parentWorkspaceId) {
      return { error: "A sub-workspace cannot have sub-workspaces of its own." };
    }
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Give the client workspace a name." };

    const child = await db.workspace.create({
      data: {
        name,
        // Clients inherit the agency's plan limits and branding rather than
        // starting on free with the product's own name on the login screen.
        plan: workspace.plan,
        parentWorkspaceId: workspace.id,
        brandName: workspace.brandName,
        brandColor: workspace.brandColor,
        brandLogoUrl: workspace.brandLogoUrl,
        memberships: { create: { userId: user.id, role: "owner" } },
      },
    });
    revalidatePath("/settings");
    return { created: child.name };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const target = String(formData.get("workspaceId") ?? "");
  await setActiveWorkspace(target);
  redirect("/dashboard");
}

export async function saveBrandingAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("owner");
  const color = String(formData.get("brandColor") ?? "").trim();
  await db.workspace.update({
    where: { id: workspace.id },
    data: {
      brandName: String(formData.get("brandName") ?? "").trim().slice(0, 60),
      // Only hex, because the value is interpolated into inline styles.
      brandColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "",
      brandLogoUrl: String(formData.get("brandLogoUrl") ?? "").trim().slice(0, 500),
    },
  });
  revalidatePath("/settings", "layout");
}

/** Client workspaces an agency owns, for the settings list. */
export async function listSubWorkspaces() {
  const { workspace } = await requireWorkspace();
  return db.workspace.findMany({
    where: { parentWorkspaceId: workspace.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, createdAt: true, credits: true },
  });
}
