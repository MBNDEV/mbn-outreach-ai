"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { transportFor } from "@/lib/engine/transport";
import { textToHtml } from "@/lib/template";
import { THREAD_LABELS } from "@/lib/labels";
import type { FormState } from "@/lib/actions/auth";

async function ownedThread(threadId: string) {
  const { workspace } = await requireWorkspace();
  const thread = await db.thread.findUnique({ where: { id: threadId } });
  if (!thread || thread.workspaceId !== workspace.id) throw new Error("Thread not found.");
  return { thread, workspace };
}

export async function setThreadLabelAction(formData: FormData): Promise<void> {
  const { thread } = await ownedThread(String(formData.get("threadId") ?? ""));
  const label = String(formData.get("label") ?? "");
  if (label && !THREAD_LABELS.some((l) => l.id === label)) return;
  await db.thread.update({ where: { id: thread.id }, data: { label } });
  const { syncOpportunityFromThread } = await import("@/lib/crm");
  await syncOpportunityFromThread(thread.id);
  const { notifyLabelChange } = await import("@/lib/notify");
  await notifyLabelChange({
    workspaceId: thread.workspaceId,
    contactEmail: thread.contactEmail,
    label,
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
  });
  revalidatePath("/unibox");
  revalidatePath("/crm");
}

export async function setThreadDoneAction(formData: FormData): Promise<void> {
  const { thread } = await ownedThread(String(formData.get("threadId") ?? ""));
  await db.thread.update({
    where: { id: thread.id },
    data: { done: formData.get("done") === "true", unread: false },
  });
  revalidatePath("/unibox");
}

export async function setThreadReminderAction(formData: FormData): Promise<void> {
  const { thread } = await ownedThread(String(formData.get("threadId") ?? ""));
  const raw = String(formData.get("reminderAt") ?? "");
  await db.thread.update({
    where: { id: thread.id },
    data: { reminderAt: raw ? new Date(raw) : null },
  });
  revalidatePath("/unibox");
}

export async function markThreadReadAction(threadId: string): Promise<void> {
  const { thread } = await ownedThread(threadId);
  if (thread.unread) {
    await db.thread.update({ where: { id: thread.id }, data: { unread: false } });
  }
}

export async function sendReplyAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const { thread, workspace } = await ownedThread(String(formData.get("threadId") ?? ""));
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return { error: "Write a reply first." };
    if (!thread.accountId) return { error: "This thread has no sending account." };

    const account = await db.emailAccount.findUnique({ where: { id: thread.accountId } });
    if (!account || account.status !== "connected") {
      return { error: "The mailbox for this thread is not connected." };
    }

    const lastInbound = await db.message.findFirst({
      where: { threadId: thread.id, direction: "in" },
      orderBy: { sentAt: "desc" },
    });

    const subject = thread.subject.startsWith("Re:")
      ? thread.subject
      : `Re: ${thread.subject || "(no subject)"}`;
    const fromName = [account.senderFirstName, account.senderLastName]
      .filter(Boolean)
      .join(" ");

    const transport = await transportFor(account);
    let messageId = "";
    try {
      const info = await transport.sendMail({
        from: fromName ? `"${fromName}" <${account.email}>` : account.email,
        to: thread.contactEmail,
        subject,
        text: body,
        html: textToHtml(body),
        inReplyTo: lastInbound?.messageId || undefined,
        references: lastInbound?.messageId || undefined,
      });
      messageId = info.messageId ?? "";
    } finally {
      transport.close();
    }

    await db.$transaction([
      db.message.create({
        data: {
          workspaceId: workspace.id,
          accountId: account.id,
          threadId: thread.id,
          campaignId: thread.campaignId,
          direction: "out",
          kind: "reply",
          toEmail: thread.contactEmail,
          fromEmail: account.email,
          subject,
          bodyText: body,
          messageId,
          trackingToken: crypto.randomBytes(16).toString("hex"),
        },
      }),
      db.thread.update({
        where: { id: thread.id },
        data: {
          snippet: body.replace(/\s+/g, " ").slice(0, 140),
          lastMessageAt: new Date(),
          unread: false,
        },
      }),
    ]);
    revalidatePath("/unibox");
    return {};
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function syncNowAction(): Promise<void> {
  await requireWorkspace();
  const { runInboxSync } = await import("@/lib/engine/sync");
  await runInboxSync();
  revalidatePath("/unibox");
}
