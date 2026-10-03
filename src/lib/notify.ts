import "server-only";
import { db } from "@/lib/db";
import { POSITIVE_LABELS } from "@/lib/labels";

// Slack notifications for the moments worth interrupting someone over: a human
// replied, or a reply turned into a real opportunity. Everything else stays in
// the Unibox — a channel that pings on every event gets muted within a week.

interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
}

async function postToSlack(url: string, text: string, blocks: SlackBlock[]): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` is the notification preview and the fallback for clients that
      // cannot render blocks.
      body: JSON.stringify({ text, blocks }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[slack] ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    console.error("[slack] delivery failed:", (err as Error).message);
  }
}

async function webhookFor(workspaceId: string): Promise<string> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { slackWebhookUrl: true },
  });
  return workspace?.slackWebhookUrl ?? "";
}

export async function notifyReply(input: {
  workspaceId: string;
  from: string;
  subject: string;
  snippet: string;
  appUrl: string;
}): Promise<void> {
  const url = await webhookFor(input.workspaceId);
  if (!url) return;
  await postToSlack(url, `Reply from ${input.from}`, [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Reply from ${input.from}*\n_${input.subject || "(no subject)"}_\n\n${input.snippet.slice(0, 300)}`,
      },
    },
    {
      type: "context",
      text: { type: "mrkdwn", text: `<${input.appUrl}/unibox|Open in Unibox>` },
    },
  ]);
}

export async function notifyLabelChange(input: {
  workspaceId: string;
  contactEmail: string;
  label: string;
  appUrl: string;
}): Promise<void> {
  if (!POSITIVE_LABELS.includes(input.label)) return;
  const url = await webhookFor(input.workspaceId);
  if (!url) return;
  const readable = input.label.replace(/_/g, " ");
  await postToSlack(url, `${input.contactEmail} is ${readable}`, [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${input.contactEmail}* moved to *${readable}*` },
    },
    {
      type: "context",
      text: { type: "mrkdwn", text: `<${input.appUrl}/crm|Open the pipeline>` },
    },
  ]);
}
