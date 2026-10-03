import "server-only";
import { ImapFlow } from "imapflow";
import type { EmailAccount } from "@prisma/client";
import { decryptJson } from "@/lib/vault";
import { accessTokenFor } from "@/lib/mail/token";
import type { AccountCredentials, SmtpCredentials, OAuthCredentials } from "@/lib/mail/health";

export async function imapClientFor(account: EmailAccount): Promise<ImapFlow> {
  const creds = decryptJson<AccountCredentials>(account.credentials);
  if (creds.kind === "smtp") {
    const c = creds as SmtpCredentials;
    return new ImapFlow({
      host: c.imapHost,
      port: c.imapPort,
      secure: c.imapPort === 993,
      auth: { user: c.username, pass: c.password },
      logger: false,
      socketTimeout: 30_000,
    });
  }
  const oauth = creds as OAuthCredentials;
  return new ImapFlow({
    host: oauth.kind === "google" ? "imap.gmail.com" : "outlook.office365.com",
    port: 993,
    secure: true,
    auth: { user: account.email, accessToken: await accessTokenFor(account, oauth) },
    logger: false,
    socketTimeout: 30_000,
  });
}

/** Mailbox paths providers use for spam, in the order worth trying. */
const SPAM_PATHS = ["Junk", "[Gmail]/Spam", "Spam", "Junk Email", "INBOX.Junk"];

/** The spam folder this account actually has, or null if none is reachable. */
export async function findSpamMailbox(client: ImapFlow): Promise<string | null> {
  const list = await client.list();
  const bySpecialUse = list.find((box) => box.specialUse === "\\Junk");
  if (bySpecialUse) return bySpecialUse.path;
  const byName = list.find((box) => SPAM_PATHS.includes(box.path));
  return byName?.path ?? null;
}
