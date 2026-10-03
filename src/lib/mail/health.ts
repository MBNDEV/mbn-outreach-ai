import "server-only";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { refreshAccessToken } from "@/lib/mail/token";

export interface SmtpCredentials {
  kind: "smtp";
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  username: string;
  password: string;
}

export interface OAuthCredentials {
  kind: "google" | "microsoft";
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

export type AccountCredentials = SmtpCredentials | OAuthCredentials;

export interface HealthResult {
  ok: boolean;
  message: string;
}

async function checkSmtp(c: SmtpCredentials): Promise<HealthResult> {
  const transport = nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpPort === 465,
    auth: { user: c.username, pass: c.password },
    connectionTimeout: 15_000,
  });
  try {
    await transport.verify();
    return { ok: true, message: "SMTP login OK" };
  } catch (err) {
    return { ok: false, message: `SMTP failed: ${(err as Error).message}` };
  } finally {
    transport.close();
  }
}

async function checkImap(c: SmtpCredentials): Promise<HealthResult> {
  const client = new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapPort === 993,
    auth: { user: c.username, pass: c.password },
    logger: false,
    socketTimeout: 15_000,
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true, message: "IMAP login OK" };
  } catch (err) {
    return { ok: false, message: `IMAP failed: ${(err as Error).message}` };
  }
}

async function checkOAuth(c: OAuthCredentials, email?: string): Promise<HealthResult> {
  // Token refresh doubles as the health probe: if the refresh token is
  // revoked or expired, the provider rejects it here.
  let accessToken: string;
  try {
    accessToken = (await refreshAccessToken(c)).accessToken;
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }

  // A valid refresh token proves the grant is alive, not that the mailbox can
  // send and receive — IMAP is a separate toggle in Gmail, so an account could
  // read "connected" and never sync a reply. Probe both, as the SMTP path does.
  if (!email) return { ok: true, message: "OAuth token refresh OK (mailbox not probed)" };
  const host =
    c.kind === "google"
      ? { smtp: "smtp.gmail.com", imap: "imap.gmail.com" }
      : { smtp: "smtp.office365.com", imap: "outlook.office365.com" };

  const smtp = (async (): Promise<HealthResult> => {
    const transport = nodemailer.createTransport({
      host: host.smtp,
      port: 587,
      secure: false,
      auth: { type: "OAuth2", user: email, accessToken },
      connectionTimeout: 15_000,
    });
    try {
      await transport.verify();
      return { ok: true, message: "SMTP login OK" };
    } catch (err) {
      return { ok: false, message: `SMTP failed: ${(err as Error).message}` };
    } finally {
      transport.close();
    }
  })();

  const imap = (async (): Promise<HealthResult> => {
    const client = new ImapFlow({
      host: host.imap,
      port: 993,
      secure: true,
      auth: { user: email, accessToken },
      logger: false,
      socketTimeout: 15_000,
    });
    try {
      await client.connect();
      await client.logout();
      return { ok: true, message: "IMAP login OK" };
    } catch (err) {
      return { ok: false, message: `IMAP failed: ${(err as Error).message}` };
    }
  })();

  const [s, i] = await Promise.all([smtp, imap]);
  if (s.ok && i.ok) return { ok: true, message: "OAuth + SMTP + IMAP OK" };
  return { ok: false, message: [s, i].filter((r) => !r.ok).map((r) => r.message).join("; ") };
}

export async function checkAccountHealth(
  creds: AccountCredentials,
  email?: string
): Promise<HealthResult> {
  if (creds.kind === "smtp") {
    const [smtp, imap] = await Promise.all([checkSmtp(creds), checkImap(creds)]);
    if (smtp.ok && imap.ok) return { ok: true, message: "SMTP + IMAP OK" };
    return { ok: false, message: [smtp, imap].filter((r) => !r.ok).map((r) => r.message).join("; ") };
  }
  return checkOAuth(creds, email);
}
