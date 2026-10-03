"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { planLimits } from "@/lib/plans";
import type { FormState } from "@/lib/actions/auth";

export async function renameWorkspaceAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const name = String(formData.get("name") ?? "").trim();
  if (name) {
    await db.workspace.update({ where: { id: workspace.id }, data: { name } });
  }
  revalidatePath("/settings");
}

export interface InviteState extends FormState {
  inviteUrl?: string;
}

export async function inviteMemberAction(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const { workspace } = await requireRole("admin");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "member");
  if (!email) return { error: "Email is required." };
  if (!["member", "admin"].includes(role)) return { error: "Invalid role." };

  const limits = planLimits(workspace.plan);
  const memberCount = await db.membership.count({ where: { workspaceId: workspace.id } });
  const pendingCount = await db.invitation.count({
    where: { workspaceId: workspace.id, acceptedAt: null, expiresAt: { gt: new Date() } },
  });
  if (memberCount + pendingCount >= limits.maxMembers) {
    return { error: `Your ${limits.label} plan allows ${limits.maxMembers} members.` };
  }

  const existing = await db.user.findUnique({
    where: { email },
    include: { memberships: { where: { workspaceId: workspace.id } } },
  });
  if (existing && existing.memberships.length > 0) {
    return { error: "That person is already a member." };
  }

  const token = crypto.randomBytes(24).toString("hex");
  await db.invitation.create({
    data: {
      workspaceId: workspace.id,
      email,
      role,
      token,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    },
  });
  revalidatePath("/settings");
  // Email delivery arrives with the sending engine (phase 2); until then the
  // admin copies the link to the invitee.
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return { inviteUrl: `${appUrl}/invite/${token}` };
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  await db.invitation.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/settings");
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const { workspace, user } = await requireRole("admin");
  const membershipId = String(formData.get("id") ?? "");
  const target = await db.membership.findUnique({ where: { id: membershipId } });
  if (!target || target.workspaceId !== workspace.id) return;
  if (target.role === "owner") return; // owners cannot be removed
  if (target.userId === user.id) return; // use "leave workspace" flow later
  await db.membership.delete({ where: { id: membershipId } });
  revalidatePath("/settings");
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("owner");
  const membershipId = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!["member", "admin"].includes(role)) return;
  const target = await db.membership.findUnique({ where: { id: membershipId } });
  if (!target || target.workspaceId !== workspace.id || target.role === "owner") return;
  await db.membership.update({ where: { id: membershipId }, data: { role } });
  revalidatePath("/settings");
}
