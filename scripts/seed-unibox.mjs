// Dev-only: seeds one inbound thread so the Unibox UI can be inspected
// without a live mailbox. Run: node scripts/seed-unibox.mjs
import { PrismaClient } from "@prisma/client";
import crypto from "node:crypto";

const db = new PrismaClient();

const workspace = await db.workspace.findFirst();
if (!workspace) throw new Error("No workspace — sign up first.");
const campaign = await db.campaign.findFirst({ where: { workspaceId: workspace.id } });

const lead = await db.lead.upsert({
  where: { workspaceId_email: { workspaceId: workspace.id, email: "jane@acmeplumbing.com" } },
  create: {
    workspaceId: workspace.id,
    email: "jane@acmeplumbing.com",
    firstName: "Jane",
    lastName: "Rivera",
    company: "Acme Plumbing",
    title: "Owner",
  },
  update: {},
});

const thread = await db.thread.create({
  data: {
    workspaceId: workspace.id,
    contactEmail: lead.email,
    leadId: lead.id,
    campaignId: campaign?.id,
    subject: "Re: Quick question about Acme Plumbing",
    snippet: "Thanks for reaching out — yes, our site is definitely due for a refresh…",
    label: "interested",
    unread: true,
    lastMessageAt: new Date(),
  },
});

await db.message.create({
  data: {
    workspaceId: workspace.id,
    threadId: thread.id,
    campaignId: campaign?.id,
    direction: "out",
    toEmail: lead.email,
    fromEmail: "marketing@mybizniche.com",
    subject: "Quick question about Acme Plumbing",
    bodyText:
      "Hi Jane,\n\nI took a look at Acme Plumbing's website and noticed a few quick wins that could bring in more leads from Google.\n\nWould you be open to a short call this week?\n\nBest,\nMarketing Team",
    trackingToken: crypto.randomBytes(16).toString("hex"),
    sentAt: new Date(Date.now() - 3600_000 * 26),
  },
});

await db.message.create({
  data: {
    workspaceId: workspace.id,
    threadId: thread.id,
    campaignId: campaign?.id,
    direction: "in",
    kind: "reply",
    toEmail: "marketing@mybizniche.com",
    fromEmail: lead.email,
    subject: "Re: Quick question about Acme Plumbing",
    bodyText:
      "Thanks for reaching out — yes, our site is definitely due for a refresh. What would a redesign roughly cost, and how long does it take?\n\nJane",
    trackingToken: crypto.randomBytes(16).toString("hex"),
    sentAt: new Date(),
  },
});

console.log("Seeded thread", thread.id);
await db.$disconnect();
