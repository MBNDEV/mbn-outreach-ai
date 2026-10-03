"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { requireWorkspace, requireRole } from "@/lib/auth";
import { encryptJson, decryptJson } from "@/lib/vault";
import { planLimits } from "@/lib/plans";
import {
  checkAccountHealth,
  type AccountCredentials,
  type SmtpCredentials,
} from "@/lib/mail/health";
import type { FormState } from "@/lib/actions/auth";

async function assertAccountCapacity(workspaceId: string, plan: string, adding = 1) {
  const limits = planLimits(plan);
  const count = await db.emailAccount.count({ where: { workspaceId } });
  if (count + adding > limits.maxEmailAccounts) {
    throw new Error(
      `Your ${limits.label} plan allows ${limits.maxEmailAccounts} email accounts. Upgrade to add more.`
    );
  }
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

async function runHealthCheck(accountId: string) {
  const account = await db.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) return;
  const creds = decryptJson<AccountCredentials>(account.credentials);
  const result = await checkAccountHealth(creds, account.email);
  await db.emailAccount.update({
    where: { id: accountId },
    data: {
      status: result.ok ? "connected" : "error",
      statusMessage: result.message,
      lastCheckedAt: new Date(),
    },
  });
}

export async function addSmtpAccountAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const { workspace } = await requireRole("admin");

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const creds: SmtpCredentials = {
    kind: "smtp",
    smtpHost: String(formData.get("smtpHost") ?? "").trim(),
    smtpPort: Number(formData.get("smtpPort") ?? 587),
    imapHost: String(formData.get("imapHost") ?? "").trim(),
    imapPort: Number(formData.get("imapPort") ?? 993),
    username: String(formData.get("username") ?? "").trim() || email,
    password: String(formData.get("password") ?? ""),
  };
  if (!email || !creds.smtpHost || !creds.imapHost || !creds.password) {
    return { error: "Email, SMTP host, IMAP host, and password are required." };
  }

  try {
    await assertAccountCapacity(workspace.id, workspace.plan);
    const account = await db.emailAccount.create({
      data: {
        workspaceId: workspace.id,
        email,
        senderFirstName: String(formData.get("firstName") ?? "").trim(),
        senderLastName: String(formData.get("lastName") ?? "").trim(),
        provider: "smtp",
        credentials: encryptJson(creds),
        dailyLimit: Math.min(
          Number(formData.get("dailyLimit") ?? 30) || 30,
          planLimits(workspace.plan).maxDailyEmailsPerAccount
        ),
        tags: JSON.stringify(parseTags(String(formData.get("tags") ?? ""))),
      },
    });
    await runHealthCheck(account.id);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("Unique constraint")) {
      return { error: "That email account is already connected to this workspace." };
    }
    return { error: message };
  }
  revalidatePath("/accounts");
  redirect("/accounts");
}

interface CsvRow {
  email?: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  username?: string;
  smtp_host?: string;
  smtp_port?: string;
  imap_host?: string;
  imap_port?: string;
  daily_limit?: string;
  tags?: string;
}

export interface CsvImportState extends FormState {
  imported?: number;
  skipped?: string[];
}

export async function importCsvAction(
  _prev: CsvImportState,
  formData: FormData
): Promise<CsvImportState> {
  const { workspace } = await requireRole("admin");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to upload." };
  }

  const text = await file.text();
  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    return { error: `Could not parse CSV: ${parsed.errors[0].message}` };
  }

  const skipped: string[] = [];
  let imported = 0;

  try {
    await assertAccountCapacity(workspace.id, workspace.plan, parsed.data.length);
  } catch (err) {
    return { error: (err as Error).message };
  }

  for (const row of parsed.data) {
    const email = row.email?.trim().toLowerCase();
    if (!email || !row.password || !row.smtp_host || !row.imap_host) {
      skipped.push(`${email ?? "(missing email)"}: needs email, password, smtp_host, imap_host`);
      continue;
    }
    const creds: SmtpCredentials = {
      kind: "smtp",
      smtpHost: row.smtp_host.trim(),
      smtpPort: Number(row.smtp_port ?? 587) || 587,
      imapHost: row.imap_host.trim(),
      imapPort: Number(row.imap_port ?? 993) || 993,
      username: row.username?.trim() || email,
      password: row.password,
    };
    try {
      const account = await db.emailAccount.create({
        data: {
          workspaceId: workspace.id,
          email,
          senderFirstName: row.first_name?.trim() ?? "",
          senderLastName: row.last_name?.trim() ?? "",
          provider: "smtp",
          credentials: encryptJson(creds),
          dailyLimit: Math.min(
            Number(row.daily_limit ?? 30) || 30,
            planLimits(workspace.plan).maxDailyEmailsPerAccount
          ),
          tags: JSON.stringify(parseTags(row.tags ?? "")),
        },
      });
      imported += 1;
      // Health checks run after import; kept sequential to avoid hammering
      // one provider with parallel logins from a bulk sheet.
      await runHealthCheck(account.id);
    } catch (err) {
      const message = (err as Error).message;
      skipped.push(
        message.includes("Unique constraint")
          ? `${email}: already connected`
          : `${email}: ${message}`
      );
    }
  }

  revalidatePath("/accounts");
  return { imported, skipped };
}

export async function recheckAccountAction(formData: FormData): Promise<void> {
  await requireWorkspace();
  const id = String(formData.get("id") ?? "");
  const { workspace } = await requireWorkspace();
  const account = await db.emailAccount.findUnique({ where: { id } });
  if (account && account.workspaceId === workspace.id) {
    await runHealthCheck(id);
  }
  revalidatePath("/accounts");
}

export async function deleteAccountAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  await db.emailAccount.deleteMany({ where: { id, workspaceId: workspace.id } });
  revalidatePath("/accounts");
}

export async function updateAccountAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  const id = String(formData.get("id") ?? "");
  const account = await db.emailAccount.findUnique({ where: { id } });
  if (!account || account.workspaceId !== workspace.id) return;
  await db.emailAccount.update({
    where: { id },
    data: {
      dailyLimit: Math.min(
        Number(formData.get("dailyLimit") ?? account.dailyLimit) || account.dailyLimit,
        planLimits(workspace.plan).maxDailyEmailsPerAccount
      ),
      tags: JSON.stringify(parseTags(String(formData.get("tags") ?? ""))),
      warmupEnabled: formData.get("warmupEnabled") === "on",
    },
  });
  revalidatePath("/accounts");
}
