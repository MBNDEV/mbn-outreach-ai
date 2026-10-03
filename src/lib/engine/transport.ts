import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import type { EmailAccount } from "@prisma/client";
import { decryptJson } from "@/lib/vault";
import { accessTokenFor } from "@/lib/mail/token";
import type { AccountCredentials, SmtpCredentials, OAuthCredentials } from "@/lib/mail/health";

export async function transportFor(account: EmailAccount): Promise<Transporter> {
  const creds = decryptJson<AccountCredentials>(account.credentials);
  if (creds.kind === "smtp") {
    const c = creds as SmtpCredentials;
    return nodemailer.createTransport({
      host: c.smtpHost,
      port: c.smtpPort,
      secure: c.smtpPort === 465,
      auth: { user: c.username, pass: c.password },
      connectionTimeout: 20_000,
    });
  }
  const accessToken = await accessTokenFor(account, creds);
  return nodemailer.createTransport({
    host: creds.kind === "google" ? "smtp.gmail.com" : "smtp.office365.com",
    port: 587,
    secure: false,
    auth: { type: "OAuth2", user: account.email, accessToken },
    connectionTimeout: 20_000,
  });
}
