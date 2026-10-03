"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { hashApiKey } from "@/lib/apiauth";
import type { FormState } from "@/lib/actions/auth";

export interface ApiKeyState extends FormState {
  plainKey?: string;
}

export async function createApiKeyAction(
  _prev: ApiKeyState,
  formData: FormData
): Promise<ApiKeyState> {
  const { workspace } = await requireRole("admin");
  const name = String(formData.get("name") ?? "").trim() || "API key";
  const plainKey = `op_${crypto.randomBytes(24).toString("hex")}`;
  await db.apiKey.create({
    data: {
      workspaceId: workspace.id,
      name,
      prefix: plainKey.slice(0, 8),
      keyHash: hashApiKey(plainKey),
    },
  });
  revalidatePath("/settings");
  // Shown once; only the hash is stored.
  return { plainKey };
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  await db.apiKey.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/settings");
}

export async function addWebhookAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const { workspace } = await requireRole("admin");
  const url = String(formData.get("url") ?? "").trim();
  if (!/^https?:\/\//.test(url)) return { error: "Enter a valid http(s) URL." };
  const events = ["reply_received", "bounce_received", "lead_unsubscribed", "campaign_completed"].filter(
    (e) => formData.get(e) === "on"
  );
  if (events.length === 0) return { error: "Pick at least one event." };
  await db.webhook.create({
    data: {
      workspaceId: workspace.id,
      url,
      events: JSON.stringify(events),
      secret: crypto.randomBytes(16).toString("hex"),
    },
  });
  revalidatePath("/settings");
  return {};
}

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  await db.webhook.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/settings");
}

export async function toggleWebhookAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  const hook = await db.webhook.findUnique({ where: { id } });
  if (hook && hook.workspaceId === workspace.id) {
    await db.webhook.update({ where: { id }, data: { enabled: !hook.enabled } });
  }
  revalidatePath("/settings");
}

export async function saveSlackWebhookAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const url = String(formData.get("slackWebhookUrl") ?? "").trim();
  // Only Slack incoming-webhook URLs: this value is fetched server-side, so an
  // arbitrary URL here would turn the settings form into an SSRF primitive.
  const valid = url === "" || url.startsWith("https://hooks.slack.com/services/");
  if (!valid) return;
  await db.workspace.update({
    where: { id: workspace.id },
    data: { slackWebhookUrl: url },
  });
  revalidatePath("/settings");
}
