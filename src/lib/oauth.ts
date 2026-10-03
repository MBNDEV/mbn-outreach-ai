import "server-only";
import crypto from "node:crypto";

// Minimal OAuth authorization-code helpers for Gmail and Microsoft 365
// mailbox connections. The scopes cover XOAUTH2 SMTP/IMAP so the sending
// engine (phase 2) can reuse the same tokens.

export type OAuthProvider = "google" | "microsoft";

export function providerConfigured(provider: OAuthProvider): boolean {
  return provider === "google"
    ? Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
    : Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

function appUrl(): string {
  return process.env.APP_URL ?? "http://localhost:3000";
}

export function redirectUri(provider: OAuthProvider): string {
  return `${appUrl()}/api/oauth/${provider}/callback`;
}

// State is HMAC-signed so the callback can trust the workspace binding
// without server-side storage.
export function signState(payload: Record<string, string>): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", process.env.APP_ENCRYPTION_KEY ?? "dev")
    .update(data)
    .digest("base64url");
  return `${data}.${sig}`;
}

export function verifyState(state: string): Record<string, string> | null {
  const [data, sig] = state.split(".");
  if (!data || !sig) return null;
  const expected = crypto
    .createHmac("sha256", process.env.APP_ENCRYPTION_KEY ?? "dev")
    .update(data)
    .digest("base64url");
  // timingSafeEqual throws on a length mismatch, and a malformed payload throws
  // in JSON.parse — a forged state must yield null, never a 500.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

export function authorizeUrl(provider: OAuthProvider, state: string): string {
  if (provider === "google") {
    const p = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri("google"),
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "https://mail.google.com/ openid email profile",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }
  const p = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    redirect_uri: redirectUri("microsoft"),
    response_type: "code",
    scope:
      "offline_access openid email https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All",
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${p}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string
): Promise<TokenResponse> {
  const url =
    provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const body = new URLSearchParams({
    client_id:
      provider === "google"
        ? process.env.GOOGLE_CLIENT_ID!
        : process.env.MICROSOFT_CLIENT_ID!,
    client_secret:
      provider === "google"
        ? process.env.GOOGLE_CLIENT_SECRET!
        : process.env.MICROSOFT_CLIENT_SECRET!,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(provider),
  });
  const res = await fetch(url, { method: "POST", body });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

/** Extract the mailbox email from an OpenID id_token (unverified decode is
 *  fine here — the token came straight from the provider over TLS). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString()
    );
    return payload.email ?? payload.preferred_username ?? null;
  } catch {
    return null;
  }
}

/** Display name from the id_token, when the provider returned one. Used for the
 *  From header, which otherwise shows a bare address. */
export function nameFromIdToken(idToken: string | undefined): { first: string; last: string } {
  if (!idToken) return { first: "", last: "" };
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
    const first = payload.given_name ?? (payload.name ?? "").split(" ")[0] ?? "";
    const last = payload.family_name ?? (payload.name ?? "").split(" ").slice(1).join(" ");
    return { first: String(first), last: String(last) };
  } catch {
    return { first: "", last: "" };
  }
}
