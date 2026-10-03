"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWorkspace, requireRole } from "@/lib/auth";
import { planLimits } from "@/lib/plans";
import { checkDomainAuth, dnsScore, domainOf } from "@/lib/deliverability";
import { startPlacementTest, checkPlacementTest } from "@/lib/placement";
import type { FormState } from "@/lib/actions/auth";

async function ownedAccount(id: string) {
  const { workspace, role } = await requireWorkspace();
  const account = await db.emailAccount.findFirst({ where: { id, workspaceId: workspace.id } });
  if (!account) throw new Error("Mailbox not found.");
  return { account, workspace, role };
}

export async function runDnsCheckAction(formData: FormData): Promise<void> {
  const { account, workspace } = await ownedAccount(String(formData.get("id") ?? ""));
  const health = await checkDomainAuth(domainOf(account.email));
  const score = dnsScore(health);

  await db.$transaction([
    db.emailAccount.update({
      where: { id: account.id },
      data: { dnsHealth: JSON.stringify(health), dnsCheckedAt: new Date() },
    }),
    db.deliverabilityTest.create({
      data: {
        workspaceId: workspace.id,
        accountId: account.id,
        kind: "dns",
        score,
        summary: [
          health.spf ? "SPF" : null,
          health.dkim ? "DKIM" : null,
          health.dmarc ? "DMARC" : null,
          health.mx ? "MX" : null,
        ]
          .filter(Boolean)
          .join(" · ") || "No authentication records found",
        details: JSON.stringify(health),
      },
    }),
  ]);
  revalidatePath(`/accounts/${account.id}`);
}

export async function saveWarmupAction(formData: FormData): Promise<void> {
  const { account, workspace } = await ownedAccount(String(formData.get("id") ?? ""));
  await requireRole("admin");
  const enabled = formData.get("warmupEnabled") === "on";
  const requested = Number(formData.get("warmupTarget") ?? account.warmupTarget) || account.warmupTarget;

  await db.emailAccount.update({
    where: { id: account.id },
    data: {
      warmupEnabled: enabled,
      warmupPoolOptIn: formData.get("warmupPoolOptIn") === "on",
      // Warmup volume shares the mailbox with campaign sending, so the plan's
      // per-account ceiling has to cover both.
      warmupTarget: Math.max(2, Math.min(requested, planLimits(workspace.plan).maxDailyEmailsPerAccount)),
      warmupStartedAt: enabled ? account.warmupStartedAt ?? new Date() : null,
    },
  });
  revalidatePath(`/accounts/${account.id}`);
}

export async function startPlacementAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const { account, workspace } = await ownedAccount(String(formData.get("id") ?? ""));
    const result = await startPlacementTest(workspace.id, account.id);
    revalidatePath(`/accounts/${account.id}`);
    return "error" in result ? { error: result.error } : {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function checkPlacementAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const { workspace } = await requireWorkspace();
    const testId = String(formData.get("testId") ?? "");
    const accountId = String(formData.get("id") ?? "");
    const result = await checkPlacementTest(workspace.id, testId);
    revalidatePath(`/accounts/${accountId}`);
    return "error" in result ? { error: result.error } : {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}
