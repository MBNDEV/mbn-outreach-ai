import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaceFromApiKey, unauthorized } from "@/lib/apiauth";

export async function GET(req: NextRequest) {
  const workspace = await workspaceFromApiKey(req);
  if (!workspace) return unauthorized();
  const url = new URL(req.url);
  const take = Math.min(200, Number(url.searchParams.get("limit") ?? 100) || 100);
  const leads = await db.lead.findMany({
    where: { workspaceId: workspace.id },
    take,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    data: leads.map((l) => ({
      id: l.id,
      email: l.email,
      first_name: l.firstName,
      last_name: l.lastName,
      company: l.company,
      title: l.title,
      created_at: l.createdAt,
    })),
  });
}

interface CreateLeadBody {
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  title?: string;
  campaign_id?: string;
}

export async function POST(req: NextRequest) {
  const workspace = await workspaceFromApiKey(req);
  if (!workspace) return unauthorized();
  let body: CreateLeadBody;
  try {
    body = (await req.json()) as CreateLeadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid `email` is required" }, { status: 400 });
  }
  const lead = await db.lead.upsert({
    where: { workspaceId_email: { workspaceId: workspace.id, email } },
    create: {
      workspaceId: workspace.id,
      email,
      firstName: body.first_name ?? "",
      lastName: body.last_name ?? "",
      company: body.company ?? "",
      title: body.title ?? "",
    },
    update: {
      firstName: body.first_name || undefined,
      lastName: body.last_name || undefined,
      company: body.company || undefined,
      title: body.title || undefined,
    },
  });
  let addedToCampaign = false;
  if (body.campaign_id) {
    const campaign = await db.campaign.findUnique({ where: { id: body.campaign_id } });
    if (!campaign || campaign.workspaceId !== workspace.id) {
      return NextResponse.json({ error: "campaign_id not found" }, { status: 404 });
    }
    await db.campaignLead
      .create({ data: { campaignId: campaign.id, leadId: lead.id } })
      .then(() => {
        addedToCampaign = true;
      })
      .catch(() => {}); // already attached
  }
  return NextResponse.json(
    { data: { id: lead.id, email: lead.email, added_to_campaign: addedToCampaign } },
    { status: 201 }
  );
}
