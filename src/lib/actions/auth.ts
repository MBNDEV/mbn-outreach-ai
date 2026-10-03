"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export interface FormState {
  error?: string;
}

export async function signupAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const workspaceName = String(formData.get("workspace") ?? "").trim();
  const inviteToken = String(formData.get("inviteToken") ?? "");

  if (!name || !email || password.length < 8) {
    return { error: "Name, email, and a password of at least 8 characters are required." };
  }
  if (await db.user.findUnique({ where: { email } })) {
    return { error: "An account with that email already exists." };
  }

  const user = await db.user.create({
    data: { name, email, passwordHash: hashPassword(password) },
  });

  const invite = inviteToken
    ? await db.invitation.findUnique({ where: { token: inviteToken } })
    : null;

  if (invite && !invite.acceptedAt && invite.expiresAt > new Date()) {
    await db.$transaction([
      db.membership.create({
        data: { userId: user.id, workspaceId: invite.workspaceId, role: invite.role },
      }),
      db.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
  } else {
    const workspace = await db.workspace.create({
      data: { name: workspaceName || `${name}'s Workspace` },
    });
    await db.membership.create({
      data: { userId: user.id, workspaceId: workspace.id, role: "owner" },
    });
  }

  await createSession(user.id);
  redirect("/dashboard");
}

export async function loginAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return { error: "Invalid email or password." };
  }
  await createSession(user.id);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
