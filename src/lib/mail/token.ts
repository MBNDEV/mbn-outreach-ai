import "server-only";
import type { EmailAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { encryptJson } from "@/lib/vault";
import type { OAuthCredentials } from "@/lib/mail/health";

const TOKEN_URL: Record<OAuthCredentials["kind"], string> = {
  google: "https://oauth2.googleapis.com/token",
  microsoft: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
};

function oauthClient(kind: OAuthCredentials["kind"]) {
  return kind === "google"
    ? { id: process.env.GOOGLE_CLIENT_ID ?? "", secret: process.env.GOOGLE_CLIENT_SECRET ?? "" }
    : { id: process.env.MICROSOFT_CLIENT_ID ?? "", secret: process.env.MICROSOFT_CLIENT_SECRET ?? "" };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface RefreshedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Trade a refresh token for an access token.
 *
 * Connection failures are retried: reaching the provider is the one step every
 * send and every sync pass depends on, and a single dropped connection would
 * otherwise fail the whole pass. A rejection *from* the provider — a revoked or
 * expired grant — fails immediately with the body, since no retry can fix it.
 */
export async function refreshAccessToken(creds: OAuthCredentials): Promise<RefreshedToken> {
  const client = oauthClient(creds.kind);
  const body = new URLSearchParams({
    client_id: client.id,
    client_secret: client.secret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token",
  });

  let unreachable = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(attempt * 750);
    let res: Response;
    try {
      res = await fetch(TOKEN_URL[creds.kind], {
        method: "POST",
        body,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      unreachable = (err as Error).message;
      continue;
    }
    if (!res.ok) {
      throw new Error(`OAuth refresh rejected (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("OAuth refresh returned no access token");
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
  }
  throw new Error(`OAuth provider unreachable after 3 attempts: ${unreachable}`);
}

/**
 * A usable access token for the account, minting one only when the stored token
 * is spent. The refreshed token goes back into the vault because an access
 * token lasts an hour while the sync pass runs every two minutes — without
 * persisting it, every pass would depend on the provider being reachable at
 * that instant.
 */
export async function accessTokenFor(
  account: EmailAccount,
  creds: OAuthCredentials
): Promise<string> {
  if (creds.accessToken && creds.expiresAt && creds.expiresAt > Date.now() + 60_000) {
    return creds.accessToken;
  }
  const fresh = await refreshAccessToken(creds);
  await db.emailAccount.update({
    where: { id: account.id },
    data: {
      credentials: encryptJson({
        ...creds,
        accessToken: fresh.accessToken,
        expiresAt: fresh.expiresAt,
      }),
    },
  });
  return fresh.accessToken;
}
