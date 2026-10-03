import "server-only";
import dns from "node:dns/promises";

// The DNS a sending domain needs, and whether it is actually in place.
//
// The plan is generated per mail provider; verification then resolves the real
// records. A domain is only marked ready when the lookups agree — a checkbox
// saying "I added them" is how mail silently lands in spam for a week.

export type MailProvider = "smtp" | "google" | "microsoft";

export interface DnsRecord {
  type: "MX" | "TXT" | "CNAME";
  host: string;
  value: string;
  priority?: number;
  purpose: string;
  /** Required records gate readiness; the rest are recommended. */
  required: boolean;
}

export const MAIL_PROVIDERS: Array<{ id: MailProvider; label: string }> = [
  { id: "google", label: "Google Workspace" },
  { id: "microsoft", label: "Microsoft 365" },
  { id: "smtp", label: "Other / self-hosted SMTP" },
];

/** The records this domain needs to send authenticated mail. */
export function dnsPlan(domain: string, provider: MailProvider, appUrl: string): DnsRecord[] {
  const records: DnsRecord[] = [];

  if (provider === "google") {
    records.push({
      type: "MX",
      host: "@",
      value: "smtp.google.com",
      priority: 1,
      purpose: "Receive mail — replies and bounces come back here.",
      required: true,
    });
    records.push({
      type: "TXT",
      host: "@",
      value: "v=spf1 include:_spf.google.com ~all",
      purpose: "SPF: authorises Google to send as this domain.",
      required: true,
    });
    records.push({
      type: "CNAME",
      host: "google._domainkey",
      value: "(the DKIM value from Google Admin → Authenticate email)",
      purpose: "DKIM: signs your mail. Generate the key in Google Admin first.",
      required: false,
    });
  } else if (provider === "microsoft") {
    records.push({
      type: "MX",
      host: "@",
      value: `${domain.replace(/\./g, "-")}.mail.protection.outlook.com`,
      priority: 0,
      purpose: "Receive mail — replies and bounces come back here.",
      required: true,
    });
    records.push({
      type: "TXT",
      host: "@",
      value: "v=spf1 include:spf.protection.outlook.com -all",
      purpose: "SPF: authorises Microsoft to send as this domain.",
      required: true,
    });
    for (const selector of ["selector1", "selector2"]) {
      records.push({
        type: "CNAME",
        host: `${selector}._domainkey`,
        value: `${selector}-${domain.replace(/\./g, "-")}._domainkey.<tenant>.onmicrosoft.com`,
        purpose: "DKIM: signs your mail. Enable DKIM in the Microsoft 365 admin centre.",
        required: false,
      });
    }
  } else {
    records.push({
      type: "MX",
      host: "@",
      value: `mail.${domain}`,
      priority: 10,
      purpose: "Receive mail — point this at your mail server.",
      required: true,
    });
    records.push({
      type: "TXT",
      host: "@",
      value: `v=spf1 mx a:mail.${domain} ~all`,
      purpose: "SPF: authorises your mail server to send as this domain.",
      required: true,
    });
    records.push({
      type: "TXT",
      host: "default._domainkey",
      value: "v=DKIM1; k=rsa; p=(your DKIM public key)",
      purpose: "DKIM: signs your mail with the key your server holds.",
      required: false,
    });
  }

  records.push({
    type: "TXT",
    host: "_dmarc",
    value: "v=DMARC1; p=none; rua=mailto:dmarc@" + domain,
    purpose: "DMARC: start at p=none to collect reports, tighten once they look clean.",
    required: true,
  });

  let trackingHost = "track";
  try {
    trackingHost = `track.${new URL(appUrl).host}`;
  } catch {}
  records.push({
    type: "CNAME",
    host: "track",
    value: trackingHost,
    purpose: "Tracking domain: opens and clicks resolve under your domain, not ours.",
    required: false,
  });

  return records;
}

export interface RecordCheck {
  record: DnsRecord;
  found: boolean;
  detail: string;
}

export interface DnsVerification {
  ready: boolean;
  checks: RecordCheck[];
}

async function txt(host: string): Promise<string[]> {
  try {
    return (await dns.resolveTxt(host)).map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

/** Resolve each planned record and report what is actually there. */
export async function verifyDns(domain: string, records: DnsRecord[]): Promise<DnsVerification> {
  const checks: RecordCheck[] = [];

  for (const record of records) {
    const host = record.host === "@" ? domain : `${record.host}.${domain}`;

    if (record.type === "MX") {
      const mx = await dns.resolveMx(domain).catch(() => []);
      checks.push({
        record,
        found: mx.length > 0,
        detail: mx.length > 0 ? mx.map((m) => `${m.priority} ${m.exchange}`).join(", ") : "no MX records",
      });
      continue;
    }

    if (record.type === "TXT") {
      const values = await txt(host);
      // Match on the record's purpose rather than an exact string: providers
      // legitimately extend SPF and DMARC, and demanding a byte-for-byte match
      // would fail a correct zone.
      const prefix = record.value.slice(0, 8).toLowerCase();
      const match = values.find((value) => value.toLowerCase().startsWith(prefix));
      checks.push({
        record,
        found: Boolean(match),
        detail: match ?? (values.length > 0 ? values.join(" | ") : "not found"),
      });
      continue;
    }

    const cname = await dns.resolveCname(host).catch(() => []);
    const anyTxt = cname.length === 0 ? await txt(host) : [];
    checks.push({
      record,
      found: cname.length > 0 || anyTxt.length > 0,
      detail: cname[0] ?? anyTxt[0] ?? "not found",
    });
  }

  const ready = checks.filter((c) => c.record.required).every((c) => c.found);
  return { ready, checks };
}
