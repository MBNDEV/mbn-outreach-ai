import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const SESSION_COOKIE = "session";
const SESSION_DAYS = 30;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.session.create({ data: { token, userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { token } });
    jar.delete(SESSION_COOKIE);
  }
}

export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

const WORKSPACE_COOKIE = "workspace";

/**
 * The active workspace is whichever one the switcher last selected, falling
 * back to the oldest membership. The cookie is only a preference — it is always
 * matched against real memberships, so a tampered value cannot reach another
 * tenant's data.
 */
export async function requireWorkspace() {
  const user = await requireUser();
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  if (memberships.length === 0) redirect("/login");

  const jar = await cookies();
  const preferred = jar.get(WORKSPACE_COOKIE)?.value;
  const active = memberships.find((m) => m.workspaceId === preferred) ?? memberships[0];

  return {
    user,
    workspace: active.workspace,
    role: active.role,
    workspaces: memberships.map((m) => ({
      id: m.workspaceId,
      name: m.workspace.name,
      plan: m.workspace.plan,
      isChild: Boolean(m.workspace.parentWorkspaceId),
    })),
  };
}

/** Select the active workspace. Callable only from actions and route handlers,
 *  since a render cannot write cookies. */
export async function setActiveWorkspace(workspaceId: string): Promise<boolean> {
  const user = await requireUser();
  const membership = await db.membership.findFirst({
    where: { userId: user.id, workspaceId },
  });
  if (!membership) return false;
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return true;
}

export async function requireRole(minRole: "member" | "admin" | "owner") {
  const ctx = await requireWorkspace();
  const rank = { member: 0, admin: 1, owner: 2 } as const;
  if (rank[ctx.role as keyof typeof rank] < rank[minRole]) {
    throw new Error("You do not have permission to do that.");
  }
  return ctx;
}
