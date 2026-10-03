import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { snippetFor } from "@/lib/visitors";

/** Serves the tracking snippet for a workspace. Public by design — it carries
 *  no secret, only the workspace id the collected events are filed under. */
export async function GET(req: NextRequest) {
  const workspaceId = new URL(req.url).searchParams.get("w") ?? "";
  const workspace = workspaceId
    ? await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })
    : null;
  if (!workspace) {
    return new NextResponse("/* Unknown workspace */", {
      status: 404,
      headers: { "Content-Type": "application/javascript" },
    });
  }
  return new NextResponse(snippetFor(workspace.id, process.env.APP_URL ?? "http://localhost:3000"), {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
