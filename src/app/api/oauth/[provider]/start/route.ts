import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import {
  authorizeUrl,
  providerConfigured,
  signState,
  type OAuthProvider,
} from "@/lib/oauth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }
  const p = provider as OAuthProvider;
  if (!providerConfigured(p)) {
    return NextResponse.json(
      { error: `${p} OAuth credentials are not configured in .env` },
      { status: 400 }
    );
  }
  const { workspace } = await requireRole("admin");
  const state = signState({ workspaceId: workspace.id, ts: String(Date.now()) });
  return NextResponse.redirect(authorizeUrl(p, state));
}
