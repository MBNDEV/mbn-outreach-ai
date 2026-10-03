import "server-only";

// Registrar and mailbox-host adapters.
//
// Reselling domains and mailboxes needs accounts we may not have, so both are
// interfaces with an env-gated implementation and a bring-your-own fallback
// that always works. Availability is the exception: RDAP is a public registry
// protocol, so domain search is fully functional with no account at all.

export type DomainAvailability = "available" | "taken" | "unknown";

export interface DomainSuggestion {
  name: string;
  availability: DomainAvailability;
  priceCents: number | null;
}

/** Sending domains are usually a variation on the brand, not the brand itself:
 *  burning your primary domain's reputation on cold mail is the classic
 *  mistake this feature exists to prevent. */
const PATTERNS: Array<(base: string, tld: string) => string> = [
  (base, tld) => `try${base}.${tld}`,
  (base, tld) => `get${base}.${tld}`,
  (base, tld) => `${base}hq.${tld}`,
  (base, tld) => `${base}mail.${tld}`,
  (base, tld) => `${base}team.${tld}`,
  (base, tld) => `hey${base}.${tld}`,
];

const TLDS = ["com", "co", "net", "io"];

export function suggestionNames(seed: string, limit = 12): string[] {
  const base = seed
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[./\s]/)[0]
    .replace(/[^a-z0-9-]/g, "");
  if (!base) return [];

  const names = new Set<string>();
  for (const tld of TLDS) {
    names.add(`${base}.${tld}`);
    for (const pattern of PATTERNS) {
      if (names.size >= limit) break;
      names.add(pattern(base, tld));
    }
  }
  return [...names].slice(0, limit);
}

/**
 * Registration status straight from the registry over RDAP — no API key, no
 * registrar account. 404 means nobody has it.
 */
export async function checkAvailability(name: string): Promise<DomainAvailability> {
  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(name)}`, {
      headers: {
        Accept: "application/rdap+json",
        // Required: rdap.org and the registries it redirects to answer 403 to a
        // request with no User-Agent, which reads as every domain being
        // "unknown" rather than as an error.
        "User-Agent": "outreach-platform/1.0 (+domain availability lookup)",
      },
      signal: AbortSignal.timeout(8000),
      // Registration state changes rarely; a short cache keeps a grid of
      // suggestions from hammering the registry on every keystroke.
      next: { revalidate: 300 },
    });
    if (res.status === 404) return "available";
    if (res.ok) return "taken";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function searchDomains(seed: string): Promise<DomainSuggestion[]> {
  const names = suggestionNames(seed);
  const priceCents = domainPriceCents();
  return Promise.all(
    names.map(async (name) => ({
      name,
      availability: await checkAvailability(name),
      priceCents,
    }))
  );
}

// ---- Pricing ---------------------------------------------------------------

export function domainPriceCents(): number {
  return Number(process.env.MARKETPLACE_DOMAIN_PRICE_CENTS ?? 1800) || 1800;
}

export function mailboxPriceCents(): number {
  return Number(process.env.MARKETPLACE_MAILBOX_PRICE_CENTS ?? 400) || 400;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---- Registrar adapter -----------------------------------------------------

export interface RegistrarAdapter {
  name: string;
  register(domain: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

/** Configured only when a registrar account exists. Without one the product
 *  takes the bring-your-own path rather than pretending it can buy domains. */
export function registrar(): RegistrarAdapter | null {
  const key = process.env.PORKBUN_API_KEY;
  const secret = process.env.PORKBUN_SECRET_KEY;
  if (!key || !secret) return null;

  return {
    name: "porkbun",
    async register(domain) {
      try {
        const res = await fetch("https://api.porkbun.com/api/json/v3/domain/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apikey: key, secretapikey: secret, domain }),
          signal: AbortSignal.timeout(30_000),
        });
        const data = (await res.json()) as { status?: string; message?: string };
        if (!res.ok || data.status !== "SUCCESS") {
          return { ok: false, error: data.message ?? `Registrar returned ${res.status}` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}

// ---- Mailbox host adapter --------------------------------------------------

export interface ProvisionedMailbox {
  email: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  username: string;
}

export interface MailboxHostAdapter {
  name: string;
  create(input: {
    email: string;
    domain: string;
  }): Promise<{ ok: true; mailbox: ProvisionedMailbox } | { ok: false; error: string }>;
}

/**
 * A mailbox host we can create accounts on. Self-hosted mail servers expose
 * wildly different admin APIs, so this reads its endpoint from env rather than
 * hard-coding one vendor; unset, mailboxes take the bring-your-own path.
 */
export function mailboxHost(): MailboxHostAdapter | null {
  const endpoint = process.env.MAILBOX_HOST_API_URL;
  const token = process.env.MAILBOX_HOST_API_KEY;
  if (!endpoint || !token) return null;

  return {
    name: "configured host",
    async create({ email, domain }) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ email, domain }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          return { ok: false, error: `Mailbox host returned ${res.status}` };
        }
        const data = (await res.json()) as Partial<ProvisionedMailbox>;
        if (!data.password || !data.smtpHost || !data.imapHost) {
          return { ok: false, error: "Mailbox host response was missing credentials." };
        }
        return {
          ok: true,
          mailbox: {
            email,
            password: data.password,
            smtpHost: data.smtpHost,
            smtpPort: data.smtpPort ?? 587,
            imapHost: data.imapHost,
            imapPort: data.imapPort ?? 993,
            username: data.username ?? email,
          },
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  };
}

export function marketplaceCapabilities() {
  return {
    canRegister: registrar() !== null,
    canHostMailboxes: mailboxHost() !== null,
  };
}
