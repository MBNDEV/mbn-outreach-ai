import "server-only";
import dns from "node:dns/promises";

// Deliverability checks that need no third-party service: authentication
// records come straight from DNS, and the content score is a local heuristic.
// Inbox placement lives in placement.ts because it needs real mailboxes.

export interface DnsHealth {
  mx: boolean | null;
  spf: boolean | null;
  dkim: boolean | null;
  dmarc: boolean | null;
  notes: string[];
}

/** Selectors worth trying before calling DKIM missing — providers publish
 *  under fixed names, and there is no way to enumerate selectors from DNS. */
const DKIM_SELECTORS = [
  "google",
  "selector1",
  "selector2",
  "k1",
  "k2",
  "default",
  "dkim",
  "mail",
  "s1",
  "s2",
  "zoho",
  "fm1",
];

async function txtRecords(host: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(host);
    return records.map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

export function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export async function checkDomainAuth(domain: string): Promise<DnsHealth> {
  const notes: string[] = [];
  if (!domain) {
    return { mx: null, spf: null, dkim: null, dmarc: null, notes: ["No sending domain"] };
  }

  const [mxRecords, rootTxt, dmarcTxt] = await Promise.all([
    dns.resolveMx(domain).catch(() => []),
    txtRecords(domain),
    txtRecords(`_dmarc.${domain}`),
  ]);

  const mx = mxRecords.length > 0;
  if (!mx) notes.push("No MX records — this domain cannot receive mail, so replies and bounces are lost.");

  const spfRecord = rootTxt.find((r) => r.toLowerCase().startsWith("v=spf1"));
  const spf = Boolean(spfRecord);
  if (!spf) {
    notes.push("No SPF record. Add one listing every service allowed to send as this domain.");
  } else if (/[?~]all\s*$/.test(spfRecord!.trim()) === false && /-all\s*$/.test(spfRecord!.trim()) === false) {
    notes.push("SPF record has no explicit all-qualifier; end it with ~all or -all.");
  }

  const dmarcRecord = dmarcTxt.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  const dmarc = Boolean(dmarcRecord);
  if (!dmarc) {
    notes.push("No DMARC record. Publish p=none first to collect reports, then tighten to quarantine.");
  } else if (/p=none/i.test(dmarcRecord!)) {
    notes.push("DMARC is p=none — monitoring only. Move to quarantine once reports look clean.");
  }

  const found = await Promise.all(
    DKIM_SELECTORS.map(async (selector) => {
      const records = await txtRecords(`${selector}._domainkey.${domain}`);
      return records.some((r) => r.toLowerCase().includes("v=dkim1") || r.includes("p=")) ? selector : null;
    })
  );
  const selector = found.find(Boolean);
  const dkim = Boolean(selector);
  if (dkim) {
    notes.push(`DKIM found on selector "${selector}".`);
  } else {
    notes.push(
      "No DKIM key on the common selectors. It may use a custom selector — confirm in your provider's console."
    );
  }

  return { mx, spf, dkim, dmarc, notes };
}

export function dnsScore(health: DnsHealth): number {
  const weights: Array<[boolean | null, number]> = [
    [health.spf, 30],
    [health.dkim, 30],
    [health.dmarc, 25],
    [health.mx, 15],
  ];
  return weights.reduce((total, [ok, weight]) => total + (ok ? weight : 0), 0);
}

// ---- Content check ----------------------------------------------------------

export interface ContentIssue {
  severity: "high" | "medium" | "low";
  message: string;
}

export interface ContentReport {
  score: number;
  issues: ContentIssue[];
  wordCount: number;
}

// Phrases filters weight heavily in cold mail. Kept short on purpose: a long
// list produces noise, and the structural checks below catch more.
const SPAM_PHRASES = [
  "act now",
  "apply now",
  "buy now",
  "cash bonus",
  "click here",
  "congratulations",
  "credit card",
  "dear friend",
  "double your",
  "earn money",
  "for free",
  "free trial",
  "get paid",
  "guarantee",
  "limited time",
  "lowest price",
  "make money",
  "no obligation",
  "no risk",
  "offer expires",
  "one time offer",
  "risk free",
  "satisfaction guaranteed",
  "special promotion",
  "this is not spam",
  "unsecured credit",
  "urgent",
  "winner",
  "work from home",
];

export function checkContent(input: { subject: string; body: string }): ContentReport {
  const issues: ContentIssue[] = [];
  const subject = input.subject.trim();
  const body = input.body.trim();
  const text = `${subject}\n${body}`;
  const lower = text.toLowerCase();
  const words = body.split(/\s+/).filter(Boolean);

  for (const phrase of SPAM_PHRASES) {
    if (lower.includes(phrase)) {
      issues.push({ severity: "high", message: `Spam-trigger phrase: "${phrase}"` });
    }
  }

  const links = body.match(/https?:\/\/\S+/g) ?? [];
  if (links.length > 2) {
    issues.push({
      severity: "medium",
      message: `${links.length} links. One is plenty in a first touch; more reads as bulk mail.`,
    });
  }

  const exclamations = (text.match(/!/g) ?? []).length;
  if (exclamations > 1) {
    issues.push({ severity: "medium", message: `${exclamations} exclamation marks.` });
  }

  const shoutedWords = words.filter((w) => w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w));
  if (shoutedWords.length > 0) {
    issues.push({
      severity: "medium",
      message: `ALL-CAPS words (${shoutedWords.slice(0, 3).join(", ")}).`,
    });
  }

  if (!subject) {
    issues.push({ severity: "high", message: "Empty subject — only valid on a threaded follow-up." });
  } else if (subject.length > 60) {
    issues.push({
      severity: "low",
      message: `Subject is ${subject.length} characters; under 50 survives mobile truncation.`,
    });
  }

  if (words.length > 200) {
    issues.push({
      severity: "low",
      message: `${words.length} words. Cold mail under 120 words replies better.`,
    });
  }
  if (words.length < 15) {
    issues.push({ severity: "low", message: "Very short body — thin content can look automated." });
  }

  if (/\{\{[^}]*\}\}/.test(subject) === false && /\{\{[^}]*\}\}/.test(body) === false) {
    issues.push({
      severity: "low",
      message: "No personalization variables. Identical copy to every lead is easy to fingerprint.",
    });
  }

  const penalty = { high: 20, medium: 10, low: 4 };
  const score = Math.max(
    0,
    100 - issues.reduce((total, issue) => total + penalty[issue.severity], 0)
  );
  return { score, issues, wordCount: words.length };
}
