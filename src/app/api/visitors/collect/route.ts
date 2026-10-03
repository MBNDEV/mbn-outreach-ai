import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashIp, clientIp } from "@/lib/visitors";

// Called by the snippet from the customer's own domain, so it must answer
// cross-origin preflight and accept opaque beacon posts.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

interface Visit {
  workspaceId?: string;
  visitorId?: string;
  visitToken?: string;
  url?: string;
  referrer?: string;
}

export async function POST(req: NextRequest) {
  let body: Visit;
  try {
    body = (await req.json()) as Visit;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }
  const workspaceId = body.workspaceId ?? "";
  const visitorId = (body.visitorId ?? "").slice(0, 64);
  const url = (body.url ?? "").slice(0, 2000);
  if (!workspaceId || !visitorId || !url) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400, headers: CORS });
  }

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return NextResponse.json({ error: "Unknown workspace" }, { status: 404, headers: CORS });
  }

  // A visit token is the tracking token of the message whose link was clicked,
  // which is what ties this browser to a named lead.
  let leadId: string | null = null;
  let campaignId: string | null = null;
  if (body.visitToken) {
    const message = await db.message.findUnique({
      where: { trackingToken: body.visitToken.slice(0, 64) },
      select: { workspaceId: true, toEmail: true, campaignId: true },
    });
    if (message && message.workspaceId === workspace.id) {
      const lead = await db.lead.findUnique({
        where: { workspaceId_email: { workspaceId: workspace.id, email: message.toEmail } },
        select: { id: true },
      });
      leadId = lead?.id ?? null;
      campaignId = message.campaignId;
    }
  }

  await db.visitorEvent.create({
    data: {
      workspaceId: workspace.id,
      visitorId,
      url,
      referrer: (body.referrer ?? "").slice(0, 2000),
      ipHash: hashIp(clientIp(req.headers)),
      userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
      leadId,
      campaignId,
    },
  });

  return NextResponse.json({ ok: true }, { headers: CORS });
}
