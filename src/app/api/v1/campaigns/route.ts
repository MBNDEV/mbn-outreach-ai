import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaceFromApiKey, unauthorized } from "@/lib/apiauth";

export async function GET(req: NextRequest) {
  const workspace = await workspaceFromApiKey(req);
  if (!workspace) return unauthorized();
  const campaigns = await db.campaign.findMany({
    where: { workspaceId: workspace.id },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      _count: { select: { leads: true, messages: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    data: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      created_at: c.createdAt,
      leads: c._count.leads,
      emails_sent: c._count.messages,
    })),
  });
}
