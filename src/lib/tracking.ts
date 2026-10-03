import "server-only";
import crypto from "node:crypto";

// Click links carry an HMAC over (token, target) so the redirect endpoint can
// only be used for URLs we actually put in an email — an unsigned redirector
// on a sending domain is an open redirect anyone can point at a phishing page.

function signature(token: string, url: string): string {
  return crypto
    .createHmac("sha256", process.env.APP_ENCRYPTION_KEY ?? "")
    .update(`${token}:${url}`)
    .digest("hex")
    .slice(0, 32);
}

export function clickLink(appUrl: string, token: string, url: string): string {
  return `${appUrl}/api/t/c/${token}?u=${encodeURIComponent(url)}&s=${signature(token, url)}`;
}

export function clickSignatureValid(token: string, url: string, provided: string): boolean {
  const expected = signature(token, url);
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function unsubscribeUrls(appUrl: string, token: string) {
  return {
    /** Shown to humans: lands on a page with a confirm button. */
    page: `${appUrl}/u/${token}`,
    /** RFC 8058 target: accepts the one-click POST mail clients send. */
    oneClick: `${appUrl}/api/u/${token}`,
  };
}
