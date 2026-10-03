import "server-only";
import dns from "node:dns/promises";

// Email verification, provider-waterfall style. The built-in provider does
// syntax + MX checks (free-tier signal); paid API providers slot into
// PROVIDERS in order and the first definitive answer wins — mirroring the
// Instantly waterfall model. Each verification costs 1 credit.

export type VerifyStatus = "valid" | "risky" | "invalid";

export interface VerifyProvider {
  name: string;
  verify(email: string): Promise<VerifyStatus | null>; // null = no answer, fall through
}

const FREE_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "aol.com",
  "icloud.com",
]);

const mxCheck: VerifyProvider = {
  name: "mx-check",
  async verify(email) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return "invalid";
    const domain = email.split("@")[1].toLowerCase();
    try {
      const records = await dns.resolveMx(domain);
      if (records.length === 0) return "invalid";
      // Personal-mail domains accept anything syntactically valid; business
      // domains without SMTP probing stay "risky" rather than "valid" unless
      // a paid provider upgrades them.
      return FREE_PROVIDERS.has(domain) ? "valid" : "risky";
    } catch {
      return "invalid";
    }
  },
};

// Example of a paid slot (activates when the env key exists):
const hunter: VerifyProvider = {
  name: "hunter",
  async verify(email) {
    const key = process.env.HUNTER_API_KEY;
    if (!key) return null;
    const res = await fetch(
      `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${key}`,
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { status?: string } };
    switch (data.data?.status) {
      case "valid":
        return "valid";
      case "invalid":
      case "disposable":
        return "invalid";
      case "accept_all":
      case "unknown":
        return "risky";
      default:
        return null;
    }
  },
};

const PROVIDERS: VerifyProvider[] = [hunter, mxCheck];

export async function verifyEmail(email: string): Promise<VerifyStatus> {
  for (const provider of PROVIDERS) {
    try {
      const result = await provider.verify(email.toLowerCase());
      if (result) return result;
    } catch {
      // fall through to the next provider
    }
  }
  return "risky";
}
