import "server-only";
import type { Agent } from "@prisma/client";
import { db } from "@/lib/db";
import { memoryContext, audienceFrom, briefFrom } from "@/lib/agent/memory";
import { POSITIVE_LABELS } from "@/lib/labels";

// The agent loop. Each pass, for every active agent:
//   1. make sure it owns a campaign to put leads into
//   2. find candidate leads it has not handled yet
//   3. propose them for approval, or queue them directly if auto-approve is on
//   4. escalate positive replies a human should answer
// It sends nothing: once its campaign is active the ordinary send engine takes
// over, which keeps every rate limit, stop rule and blocklist in one place.

const FALLBACK_SEQUENCE = [
  {
    waitDays: 0,
    subject: "Quick question about {{company}}",
    body: "{{RANDOM|Hi|Hello}} {{first_name|there}},\n\nI work with businesses like {{company}} and noticed a couple of things that might be worth a look.\n\nWorth a short call this week?\n\nThanks",
  },
  {
    waitDays: 3,
    subject: "",
    body: "{{RANDOM|Hi|Hello}} {{first_name|there}},\n\nFloating this back to the top of your inbox in case it got buried.\n\nHappy to share what I found either way.",
  },
];

async function log(agentId: string, kind: string, message: string): Promise<void> {
  await db.agentEvent.create({ data: { agentId, kind, message } });
}

/** Create the campaign the agent feeds, with copy generated from workspace
 *  memory when the AI layer is configured and a usable template otherwise. */
async function ensureCampaign(agent: Agent): Promise<string> {
  if (agent.campaignId) {
    const existing = await db.campaign.findUnique({
      where: { id: agent.campaignId },
      select: { id: true },
    });
    if (existing) return existing.id;
  }

  const context = await memoryContext(agent.workspaceId);
  let steps = FALLBACK_SEQUENCE;
  let source = "a built-in template";

  const { aiAvailable, generateSequence } = await import("@/lib/ai");
  if (aiAvailable() && context.complete) {
    try {
      const brief = briefFrom(context);
      const generated = await generateSequence({
        business: brief.business,
        offer: brief.offer,
        audience: audienceFrom(context, agent.icp),
        stepCount: 3,
      });
      steps = generated.steps;
      source = "workspace memory";
    } catch (err) {
      // A generation failure must not stop the agent: it ships the template and
      // says so in the feed, where a human can rewrite the copy.
      await log(agent.id, "error", `Copy generation failed (${(err as Error).message}); used the template instead.`);
    }
  } else if (!context.complete) {
    await log(
      agent.id,
      "idle",
      "Memory is missing the business, an offer or an ideal customer, so the campaign uses the template. Fill memory in for copy written from your own words."
    );
  }

  const accounts = await db.emailAccount.findMany({
    where: { workspaceId: agent.workspaceId, status: "connected" },
    select: { id: true },
  });

  const campaign = await db.campaign.create({
    data: {
      workspaceId: agent.workspaceId,
      name: `${agent.name} — outreach`,
      // Stays a draft until a human approves the first lead; the send engine
      // only looks at active campaigns.
      status: "draft",
      steps: {
        create: steps.map((step, index) => ({
          order: index,
          waitDays: step.waitDays,
          variants: { create: [{ label: "A", subject: step.subject, body: step.body }] },
        })),
      },
      accounts: { create: accounts.map((account) => ({ accountId: account.id })) },
    },
  });

  await db.agent.update({ where: { id: agent.id }, data: { campaignId: campaign.id } });
  await log(
    agent.id,
    "campaign_created",
    `Built campaign "${campaign.name}" with ${steps.length} steps from ${source}.`
  );
  return campaign.id;
}

/** Leads in the workspace this agent has neither proposed nor queued. */
async function candidates(agent: Agent, campaignId: string, limit: number) {
  if (limit <= 0) return [];
  const [handled, alreadyInCampaign, blocked, unsubscribed] = await Promise.all([
    db.agentTask.findMany({
      where: { agentId: agent.id, type: "lead_approval" },
      select: { leadId: true },
    }),
    db.campaignLead.findMany({ where: { campaignId }, select: { leadId: true } }),
    db.blocklistEntry.findMany({ where: { workspaceId: agent.workspaceId }, select: { value: true } }),
    db.unsubscribe.findMany({ where: { workspaceId: agent.workspaceId }, select: { email: true } }),
  ]);

  const skip = new Set(
    [...handled.map((task) => task.leadId), ...alreadyInCampaign.map((row) => row.leadId)].filter(
      (id): id is string => Boolean(id)
    )
  );
  const blockedValues = new Set(blocked.map((entry) => entry.value));
  const optedOut = new Set(unsubscribed.map((row) => row.email));

  const pool = await db.lead.findMany({
    where: {
      workspaceId: agent.workspaceId,
      id: { notIn: [...skip] },
      // Known-bad addresses waste a send and a reputation point each.
      verifyStatus: { in: ["unverified", "valid"] },
    },
    orderBy: { createdAt: "asc" },
    take: limit * 3,
  });

  return pool
    .filter((lead) => !optedOut.has(lead.email))
    .filter(
      (lead) =>
        !blockedValues.has(lead.email) && !blockedValues.has(lead.email.split("@")[1] ?? "")
    )
    .slice(0, limit);
}

async function queuedToday(agentId: string): Promise<number> {
  const since = new Date();
  since.setHours(since.getHours() - 24);
  return db.agentTask.count({
    where: {
      agentId,
      type: "lead_approval",
      status: { in: ["pending", "approved"] },
      createdAt: { gte: since },
    },
  });
}

/** Add an approved lead to the agent's campaign and start the campaign if this
 *  is the first one. Shared by the loop's auto-approve path and the UI action. */
export async function queueLead(agent: Agent, leadId: string): Promise<void> {
  const campaignId = await ensureCampaign(agent);
  await db.campaignLead.create({ data: { campaignId, leadId } }).catch(() => {});

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true, name: true },
  });
  if (campaign?.status === "draft") {
    const accounts = await db.campaignAccount.count({ where: { campaignId } });
    if (accounts > 0) {
      await db.campaign.update({ where: { id: campaignId }, data: { status: "active" } });
      await log(agent.id, "queued", `Activated "${campaign.name}" — the send engine takes it from here.`);
    } else {
      await log(
        agent.id,
        "idle",
        "Leads are queued but no mailbox is connected, so the campaign stays a draft. Connect one to start sending."
      );
    }
  }
}

/** Positive replies in the agent's campaign that no human has been asked about. */
async function escalateReplies(agent: Agent, campaignId: string): Promise<number> {
  const threads = await db.thread.findMany({
    where: {
      workspaceId: agent.workspaceId,
      campaignId,
      label: { in: POSITIVE_LABELS },
      done: false,
    },
    select: { id: true, contactEmail: true, label: true },
  });
  if (threads.length === 0) return 0;

  const existing = await db.agentTask.findMany({
    where: { agentId: agent.id, type: "reply_escalation" },
    select: { threadId: true },
  });
  const known = new Set(existing.map((task) => task.threadId));

  let escalated = 0;
  for (const thread of threads) {
    if (known.has(thread.id)) continue;
    await db.agentTask.create({
      data: {
        workspaceId: agent.workspaceId,
        agentId: agent.id,
        type: "reply_escalation",
        threadId: thread.id,
        note: `${thread.contactEmail} is ${thread.label.replace(/_/g, " ")} — worth a human reply.`,
      },
    });
    await log(
      agent.id,
      "escalated",
      `${thread.contactEmail} replied positively (${thread.label.replace(/_/g, " ")}). Handed to you.`
    );
    escalated += 1;
  }
  return escalated;
}

async function runAgent(agent: Agent): Promise<{ proposed: number; escalated: number }> {
  const campaignId = await ensureCampaign(agent);
  const remaining = agent.dailyLeadTarget - (await queuedToday(agent.id));
  const leads = await candidates(agent, campaignId, remaining);

  let proposed = 0;
  for (const lead of leads) {
    if (agent.autoApprove) {
      await db.agentTask.create({
        data: {
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          type: "lead_approval",
          status: "approved",
          leadId: lead.id,
          note: "Auto-approved.",
          resolvedAt: new Date(),
        },
      });
      await queueLead(agent, lead.id);
    } else {
      await db.agentTask.create({
        data: {
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          type: "lead_approval",
          leadId: lead.id,
          note: [lead.title, lead.company].filter(Boolean).join(" at ") || lead.email,
        },
      });
    }
    proposed += 1;
  }

  if (proposed > 0) {
    await log(
      agent.id,
      agent.autoApprove ? "queued" : "proposed",
      agent.autoApprove
        ? `Queued ${proposed} lead${proposed === 1 ? "" : "s"} into the campaign.`
        : `Found ${proposed} lead${proposed === 1 ? "" : "s"} for you to approve.`
    );
  } else if (remaining <= 0) {
    await log(agent.id, "idle", `Daily target of ${agent.dailyLeadTarget} already reached.`);
  } else {
    await log(
      agent.id,
      "idle",
      "No new leads in the database to work with. Import or search for more and I'll pick them up."
    );
  }

  const escalated = await escalateReplies(agent, campaignId);
  await db.agent.update({ where: { id: agent.id }, data: { lastRunAt: new Date() } });
  return { proposed, escalated };
}

let running = false;

export async function runAgentTick(): Promise<{
  agents: number;
  proposed: number;
  escalated: number;
  errors: number;
}> {
  if (running) return { agents: 0, proposed: 0, escalated: 0, errors: 0 };
  running = true;
  try {
    const agents = await db.agent.findMany({ where: { status: "active" } });
    let proposed = 0;
    let escalated = 0;
    let errors = 0;
    for (const agent of agents) {
      try {
        const result = await runAgent(agent);
        proposed += result.proposed;
        escalated += result.escalated;
      } catch (err) {
        errors += 1;
        const message = (err as Error).message;
        console.error(`[agent] ${agent.name}:`, message);
        await log(agent.id, "error", message.slice(0, 300)).catch(() => {});
      }
    }
    return { agents: agents.length, proposed, escalated, errors };
  } finally {
    running = false;
  }
}

/** One pass for a single agent, for the "Run now" button. */
export async function runAgentOnce(agentId: string): Promise<{ proposed: number; escalated: number }> {
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId } });
  return runAgent(agent);
}
