import "server-only";
import { db, icontains } from "@/lib/db";
import { THREAD_LABELS } from "@/lib/labels";
import { planLimits } from "@/lib/plans";
import { isMemoryKind, MEMORY_KINDS } from "@/lib/agent/memory";

// The copilot's tools are thin wrappers over the same workspace-scoped
// operations the UI performs. Every one re-checks the workspace: the model
// chooses the arguments, so an id it produces is untrusted input, not proof of
// access.
//
// `write: true` marks a tool that changes something or sends mail. Those are
// the ones a human approves — reads run unattended.

export interface ToolContext {
  workspaceId: string;
}

export interface CopilotTool {
  name: string;
  description: string;
  write: boolean;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  run(ctx: ToolContext, input: Record<string, unknown>): Promise<string>;
}

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value.trim() : "";
}

function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(input[key]);
  return Number.isFinite(value) ? value : fallback;
}

/** Describe a campaign the way a human would read it out. */
async function campaignLine(campaign: {
  id: string;
  name: string;
  status: string;
  _count: { leads: number; messages: number };
}): Promise<string> {
  return `${campaign.name} (id ${campaign.id}) — ${campaign.status}, ${campaign._count.leads} leads, ${campaign._count.messages} messages`;
}

export const COPILOT_TOOLS: CopilotTool[] = [
  {
    name: "get_workspace_overview",
    description:
      "Current state of the workspace: plan, credit balance, and counts of campaigns, mailboxes, leads and unread replies. Call this when the user asks how things are going, or before advising on anything that depends on what already exists.",
    write: false,
    input_schema: { type: "object", properties: {} },
    async run(ctx) {
      const [workspace, campaigns, accounts, leads, unread, positive] = await Promise.all([
        db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } }),
        db.campaign.groupBy({
          by: ["status"],
          where: { workspaceId: ctx.workspaceId },
          _count: true,
        }),
        db.emailAccount.count({ where: { workspaceId: ctx.workspaceId, status: "connected" } }),
        db.lead.count({ where: { workspaceId: ctx.workspaceId } }),
        db.thread.count({ where: { workspaceId: ctx.workspaceId, unread: true, done: false } }),
        db.thread.count({
          where: {
            workspaceId: ctx.workspaceId,
            label: { in: ["interested", "meeting_booked", "meeting_completed", "won"] },
          },
        }),
      ]);
      const limits = planLimits(workspace.plan);
      const byStatus = campaigns.map((row) => `${row._count} ${row.status}`).join(", ") || "none";
      return [
        `Workspace: ${workspace.name} (${limits.label} plan, ${workspace.credits} credits)`,
        `Campaigns: ${byStatus}`,
        `Connected mailboxes: ${accounts} (plan allows ${limits.maxEmailAccounts})`,
        `Leads in database: ${leads}`,
        `Unread replies: ${unread} · positive-labelled threads: ${positive}`,
      ].join("\n");
    },
  },

  {
    name: "list_campaigns",
    description:
      "List this workspace's campaigns with their status, lead count and messages sent. Use it to find a campaign's id before acting on it.",
    write: false,
    input_schema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "active", "paused", "completed"],
          description: "Only return campaigns in this status.",
        },
      },
    },
    async run(ctx, input) {
      const status = str(input, "status");
      const campaigns = await db.campaign.findMany({
        where: { workspaceId: ctx.workspaceId, ...(status ? { status } : {}) },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: { _count: { select: { leads: true, messages: true } } },
      });
      if (campaigns.length === 0) return "No campaigns match.";
      return (await Promise.all(campaigns.map(campaignLine))).join("\n");
    },
  },

  {
    name: "get_campaign_performance",
    description:
      "Sent, open, click, reply and bounce figures for one campaign, plus its sequence steps. Use it before giving advice about a specific campaign's results.",
    write: false,
    input_schema: {
      type: "object",
      properties: { campaign_id: { type: "string" } },
      required: ["campaign_id"],
    },
    async run(ctx, input) {
      const campaign = await db.campaign.findFirst({
        where: { id: str(input, "campaign_id"), workspaceId: ctx.workspaceId },
        include: { steps: { orderBy: { order: "asc" }, include: { variants: true } } },
      });
      if (!campaign) return "No campaign with that id in this workspace.";

      const [sent, opened, clicks, replies, bounced, statuses] = await Promise.all([
        db.message.count({ where: { campaignId: campaign.id, direction: "out" } }),
        db.message.count({
          where: { campaignId: campaign.id, direction: "out", openedAt: { not: null } },
        }),
        db.message.aggregate({
          where: { campaignId: campaign.id, direction: "out" },
          _sum: { clickCount: true },
        }),
        db.message.count({
          where: { campaignId: campaign.id, direction: "in", kind: "reply" },
        }),
        db.campaignLead.count({ where: { campaignId: campaign.id, status: "bounced" } }),
        db.campaignLead.groupBy({
          by: ["status"],
          where: { campaignId: campaign.id },
          _count: true,
        }),
      ]);
      const pct = (n: number) => (sent === 0 ? "n/a" : `${Math.round((n / sent) * 100)}%`);
      return [
        `${campaign.name} — ${campaign.status}`,
        `Sent ${sent} · opened ${opened} (${pct(opened)}) · clicks ${clicks._sum.clickCount ?? 0} · replies ${replies} (${pct(replies)}) · bounced ${bounced}`,
        `Lead states: ${statuses.map((s) => `${s._count} ${s.status}`).join(", ") || "none"}`,
        `Sequence: ${campaign.steps
          .map(
            (step, i) =>
              `step ${i + 1} (wait ${step.waitDays}d, ${step.variants.length} variant${step.variants.length === 1 ? "" : "s"})`
          )
          .join("; ") || "no steps"}`,
      ].join("\n");
    },
  },

  {
    name: "list_mailboxes",
    description:
      "Connected sending mailboxes with status, today's send count against the daily limit, and whether warmup is on.",
    write: false,
    input_schema: { type: "object", properties: {} },
    async run(ctx) {
      const accounts = await db.emailAccount.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: "asc" },
      });
      if (accounts.length === 0) {
        return "No mailboxes connected. Nothing can send until one is.";
      }
      return accounts
        .map(
          (a) =>
            `${a.email} (id ${a.id}) — ${a.status}${a.statusMessage ? ` (${a.statusMessage})` : ""}, ${a.sentToday}/${a.dailyLimit} sent today, warmup ${a.warmupEnabled ? "on" : "off"}`
        )
        .join("\n");
    },
  },

  {
    name: "search_leads",
    description:
      "Search the workspace lead database by email, company or name. Returns matching leads with their verification status.",
    write: false,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Substring to match on email, company or name." },
        limit: { type: "integer", description: "Max rows to return (default 20, max 100)." },
      },
    },
    async run(ctx, input) {
      const query = str(input, "query");
      const leads = await db.lead.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          ...(query
            ? {
                OR: [
                  { email: icontains(query) },
                  { company: icontains(query) },
                  { firstName: icontains(query) },
                  { lastName: icontains(query) },
                ],
              }
            : {}),
        },
        take: Math.max(1, Math.min(100, num(input, "limit", 20))),
        orderBy: { createdAt: "desc" },
      });
      if (leads.length === 0) return "No leads match.";
      return leads
        .map(
          (l) =>
            `${l.email} — ${[l.firstName, l.lastName].filter(Boolean).join(" ") || "no name"}${l.company ? `, ${l.company}` : ""} (${l.verifyStatus})`
        )
        .join("\n");
    },
  },

  {
    name: "list_replies",
    description:
      "Recent reply threads from the Unibox, newest first, with their pipeline label and a snippet. Use it to answer questions about who replied and what they said.",
    write: false,
    input_schema: {
      type: "object",
      properties: {
        label: {
          type: "string",
          enum: THREAD_LABELS.map((l) => l.id),
          description: "Only threads carrying this pipeline label.",
        },
        limit: { type: "integer", description: "Max threads (default 15, max 50)." },
      },
    },
    async run(ctx, input) {
      const label = str(input, "label");
      const threads = await db.thread.findMany({
        where: { workspaceId: ctx.workspaceId, ...(label ? { label } : {}) },
        orderBy: { lastMessageAt: "desc" },
        take: Math.max(1, Math.min(50, num(input, "limit", 15))),
      });
      if (threads.length === 0) return "No reply threads match.";
      return threads
        .map(
          (t) =>
            `${t.contactEmail} (thread ${t.id}) — ${t.label || "unlabelled"}${t.done ? ", done" : ""}: ${t.snippet.slice(0, 120)}`
        )
        .join("\n");
    },
  },

  {
    name: "read_memory",
    description:
      "What the workspace has recorded about its own business, offers, ideal customers and guidance rules. Read this before writing any copy so the wording matches the business.",
    write: false,
    input_schema: { type: "object", properties: {} },
    async run(ctx) {
      const records = await db.memoryRecord.findMany({
        where: { workspaceId: ctx.workspaceId, enabled: true },
        orderBy: { createdAt: "asc" },
      });
      if (records.length === 0) return "Memory is empty.";
      return records.map((r) => `[${r.kind}] ${r.content}`).join("\n");
    },
  },

  {
    name: "create_campaign",
    description:
      "Create a new draft campaign. It starts empty — with no sequence, leads or mailbox — and sends nothing until a human finishes setting it up and launches it.",
    write: true,
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    async run(ctx, input) {
      const name = str(input, "name") || "Untitled Campaign";
      const campaign = await db.campaign.create({
        data: {
          workspaceId: ctx.workspaceId,
          name,
          steps: { create: [{ order: 0, waitDays: 0, variants: { create: [{ label: "A" }] } }] },
        },
      });
      return `Created draft campaign "${name}" (id ${campaign.id}) with one empty step.`;
    },
  },

  {
    name: "add_leads_to_campaign",
    description:
      "Add existing workspace leads to a campaign by email address. Leads not already in the database are skipped — import them first. The campaign sends on its own schedule once active.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        emails: { type: "array", items: { type: "string" }, description: "Lead email addresses." },
      },
      required: ["campaign_id", "emails"],
    },
    async run(ctx, input) {
      const campaign = await db.campaign.findFirst({
        where: { id: str(input, "campaign_id"), workspaceId: ctx.workspaceId },
      });
      if (!campaign) return "No campaign with that id in this workspace.";
      const emails = Array.isArray(input.emails)
        ? input.emails.filter((e): e is string => typeof e === "string")
        : [];
      if (emails.length === 0) return "No emails given.";

      let added = 0;
      const missing: string[] = [];
      for (const raw of emails.slice(0, 500)) {
        const email = raw.trim().toLowerCase();
        const lead = await db.lead.findUnique({
          where: { workspaceId_email: { workspaceId: ctx.workspaceId, email } },
        });
        if (!lead) {
          missing.push(email);
          continue;
        }
        await db.campaignLead
          .create({ data: { campaignId: campaign.id, leadId: lead.id } })
          .then(() => {
            added += 1;
          })
          .catch(() => {}); // already in the campaign
      }
      return `Added ${added} lead${added === 1 ? "" : "s"} to "${campaign.name}".${
        missing.length > 0 ? ` Not in the database: ${missing.slice(0, 10).join(", ")}.` : ""
      }`;
    },
  },

  {
    name: "set_campaign_status",
    description:
      "Pause or resume a campaign. Activating one starts real email going out to its leads on the next engine pass.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        status: { type: "string", enum: ["active", "paused"] },
      },
      required: ["campaign_id", "status"],
    },
    async run(ctx, input) {
      const status = str(input, "status");
      if (!["active", "paused"].includes(status)) return "Status must be active or paused.";
      const campaign = await db.campaign.findFirst({
        where: { id: str(input, "campaign_id"), workspaceId: ctx.workspaceId },
      });
      if (!campaign) return "No campaign with that id in this workspace.";

      if (status === "active") {
        const [accounts, leads, content] = await Promise.all([
          db.campaignAccount.count({ where: { campaignId: campaign.id } }),
          db.campaignLead.count({ where: { campaignId: campaign.id } }),
          db.variant.findFirst({
            where: { step: { campaignId: campaign.id }, enabled: true, NOT: { body: "" } },
          }),
        ]);
        if (!content) return "Refused: the sequence has no copy yet.";
        if (accounts === 0) return "Refused: no sending mailbox is attached.";
        if (leads === 0) return "Refused: the campaign has no leads.";
      }

      await db.campaign.update({ where: { id: campaign.id }, data: { status } });
      return `"${campaign.name}" is now ${status}.`;
    },
  },

  {
    name: "set_thread_label",
    description:
      "Set the pipeline label on a reply thread. Positive labels create or advance a CRM opportunity.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        label: { type: "string", enum: THREAD_LABELS.map((l) => l.id) },
      },
      required: ["thread_id", "label"],
    },
    async run(ctx, input) {
      const label = str(input, "label");
      if (!THREAD_LABELS.some((l) => l.id === label)) return "Not a valid label.";
      const thread = await db.thread.findFirst({
        where: { id: str(input, "thread_id"), workspaceId: ctx.workspaceId },
      });
      if (!thread) return "No thread with that id in this workspace.";
      await db.thread.update({ where: { id: thread.id }, data: { label } });
      const { syncOpportunityFromThread } = await import("@/lib/crm");
      await syncOpportunityFromThread(thread.id);
      return `${thread.contactEmail} is now labelled ${label.replace(/_/g, " ")}.`;
    },
  },

  {
    name: "add_memory",
    description:
      "Record a durable fact about the business: what it does, an offer, an ideal customer, or a rule to follow. Campaign copy is generated from these.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: MEMORY_KINDS.map((k) => k.id) },
        content: { type: "string" },
      },
      required: ["kind", "content"],
    },
    async run(ctx, input) {
      const kind = str(input, "kind");
      const content = str(input, "content");
      if (!isMemoryKind(kind)) return "Not a valid memory kind.";
      if (!content) return "Nothing to record.";
      await db.memoryRecord.create({
        data: { workspaceId: ctx.workspaceId, kind, content: content.slice(0, 2000) },
      });
      return `Recorded under ${kind}: ${content}`;
    },
  },

  {
    name: "add_to_blocklist",
    description:
      "Block an email address or whole domain so no campaign in this workspace ever contacts it.",
    write: true,
    input_schema: {
      type: "object",
      properties: {
        value: { type: "string", description: "An email address or a bare domain." },
      },
      required: ["value"],
    },
    async run(ctx, input) {
      const value = str(input, "value").toLowerCase();
      if (!value) return "Nothing to block.";
      await db.blocklistEntry
        .create({ data: { workspaceId: ctx.workspaceId, value } })
        .catch(() => {}); // already blocked
      return `${value} is blocklisted.`;
    },
  },
];

export function findTool(name: string): CopilotTool | undefined {
  return COPILOT_TOOLS.find((tool) => tool.name === name);
}

/** The tool array as the Messages API expects it. */
export function toolDefinitions() {
  return COPILOT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema,
  }));
}
