import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { encryptJson } from "@/lib/vault";
import { planLimits } from "@/lib/plans";
import {
  exchangeCode,
  emailFromIdToken,
  nameFromIdToken,
  verifyState,
  type OAuthProvider,
} from "@/lib/oauth";
import { checkAccountHealth, type OAuthCredentials } from "@/lib/mail/health";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "microsoft") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }
  const p = provider as OAuthProvider;
  const url = new URL(req.url);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(`${appUrl}/accounts?oauth_error=${encodeURIComponent(error)}`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const statePayload = state ? verifyState(state) : null;
  if (!code || !statePayload) {
    return NextResponse.redirect(`${appUrl}/accounts?oauth_error=invalid_state`);
  }

  // The session user must still be an admin of the workspace the flow started
  // from — the signed state alone is not an authorization grant.
  const { workspace } = await requireRole("admin");
  if (workspace.id !== statePayload.workspaceId) {
    return NextResponse.redirect(`${appUrl}/accounts?oauth_error=workspace_mismatch`);
  }

  try {
    const tokens = await exchangeCode(p, code);
    const email = emailFromIdToken(tokens.id_token)?.toLowerCase();
    if (!email) {
      return NextResponse.redirect(`${appUrl}/accounts?oauth_error=no_email_in_token`);
    }
    if (!tokens.refresh_token) {
      return NextResponse.redirect(`${appUrl}/accounts?oauth_error=no_refresh_token`);
    }

    const limits = planLimits(workspace.plan);
    const count = await db.emailAccount.count({ where: { workspaceId: workspace.id } });
    const existing = await db.emailAccount.findUnique({
      where: { workspaceId_email: { workspaceId: workspace.id, email } },
    });
    if (!existing && count >= limits.maxEmailAccounts) {
      return NextResponse.redirect(`${appUrl}/accounts?oauth_error=plan_limit`);
    }

    const creds: OAuthCredentials = {
      kind: p,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    // A granted token is not proof the mailbox can send and receive — IMAP is
    // a separate toggle in Gmail, and the scope can be right while the mailbox
    // is unusable. Test it now rather than discovering it on the first send.
    const health = await checkAccountHealth(creds, email);
    const name = nameFromIdToken(tokens.id_token);

    const data = {
      provider: p,
      credentials: encryptJson(creds),
      status: health.ok ? "connected" : "error",
      statusMessage: health.message,
      lastCheckedAt: new Date(),
    };
    if (existing) {
      await db.emailAccount.update({ where: { id: existing.id }, data });
    } else {
      await db.emailAccount.create({
        data: {
          ...data,
          workspaceId: workspace.id,
          email,
          // A bare address in the From header reads worse than a name; the
          // provider already told us who this is.
          senderFirstName: name.first,
          senderLastName: name.last,
        },
      });
    }
    return NextResponse.redirect(
      health.ok ? `${appUrl}/accounts` : `${appUrl}/accounts?oauth_error=${encodeURIComponent(health.message.slice(0, 120))}`
    );
  } catch (err) {
    return NextResponse.redirect(
      `${appUrl}/accounts?oauth_error=${encodeURIComponent((err as Error).message.slice(0, 100))}`
    );
  }
}
