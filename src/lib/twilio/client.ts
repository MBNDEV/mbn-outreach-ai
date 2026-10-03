import "server-only";
import crypto from "node:crypto";

// Twilio REST client, hand-rolled against the documented form-encoded API.
//
// The base URL is overridable so the send path can be exercised against a local
// stand-in without an account — the same seam Twilio's own regional endpoints
// use. Without credentials every call refuses rather than pretending to send.

function base(): string {
  return process.env.TWILIO_API_BASE ?? "https://api.twilio.com";
}

function credentials(): { sid: string; token: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token ? { sid, token } : null;
}

export function twilioAvailable(): boolean {
  return credentials() !== null;
}

async function post(
  path: string,
  form: Record<string, string>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, error: "Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to send." };
  }
  try {
    const res = await fetch(`${base()}/2010-04-01/Accounts/${creds.sid}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${creds.sid}:${creds.token}`).toString("base64")}`,
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(data.message ?? `Twilio returned ${res.status}`),
      };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export interface SentSms {
  sid: string;
  status: string;
}

export async function sendSms(input: {
  to: string;
  from: string;
  body: string;
  statusCallback?: string;
}): Promise<{ ok: true; sms: SentSms } | { ok: false; error: string }> {
  const form: Record<string, string> = {
    To: input.to,
    From: input.from,
    Body: input.body,
  };
  if (input.statusCallback) form.StatusCallback = input.statusCallback;

  const result = await post("/Messages.json", form);
  if (!result.ok) return result;
  return {
    ok: true,
    sms: {
      sid: String(result.data.sid ?? ""),
      status: String(result.data.status ?? "queued"),
    },
  };
}

/**
 * Place a call that dials the rep first and bridges to the lead once answered,
 * so nobody hears a silent line. The TwiML is inline rather than hosted: one
 * fewer moving part to keep in sync.
 */
export async function placeCall(input: {
  to: string;
  from: string;
  bridgeTo: string;
}): Promise<{ ok: true; sid: string } | { ok: false; error: string }> {
  const twiml = `<Response><Dial callerId="${escapeXml(input.from)}">${escapeXml(input.bridgeTo)}</Dial></Response>`;
  const result = await post("/Calls.json", {
    To: input.to,
    From: input.from,
    Twiml: twiml,
  });
  if (!result.ok) return result;
  return { ok: true, sid: String(result.data.sid ?? "") };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface AvailableNumber {
  number: string;
  sid: string;
  capabilities: { sms: boolean; voice: boolean; mms: boolean };
}

/** Numbers already on the account, so a workspace can pick one to send from. */
export async function listNumbers(): Promise<
  { ok: true; numbers: AvailableNumber[] } | { ok: false; error: string }
> {
  const creds = credentials();
  if (!creds) return { ok: false, error: "Twilio is not configured." };
  try {
    const res = await fetch(
      `${base()}/2010-04-01/Accounts/${creds.sid}/IncomingPhoneNumbers.json?PageSize=50`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${creds.sid}:${creds.token}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(20_000),
      }
    );
    const data = (await res.json()) as {
      incoming_phone_numbers?: Array<{
        phone_number?: string;
        sid?: string;
        capabilities?: { sms?: boolean; voice?: boolean; mms?: boolean };
      }>;
      message?: string;
    };
    if (!res.ok) return { ok: false, error: data.message ?? `Twilio returned ${res.status}` };
    return {
      ok: true,
      numbers: (data.incoming_phone_numbers ?? []).map((row) => ({
        number: row.phone_number ?? "",
        sid: row.sid ?? "",
        capabilities: {
          sms: Boolean(row.capabilities?.sms),
          voice: Boolean(row.capabilities?.voice),
          mms: Boolean(row.capabilities?.mms),
        },
      })),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---- Inbound webhook signature --------------------------------------------

/**
 * Twilio signs a webhook as HMAC-SHA1 over the full request URL with every POST
 * parameter appended in alphabetical order, keyed by the auth token.
 *
 * This is the only thing standing between a public endpoint and anyone who can
 * forge an inbound text — including a forged STOP, or a fake reply that stops a
 * campaign. Compared with timingSafeEqual so the check itself leaks nothing.
 */
export function validateSignature(input: {
  url: string;
  params: Record<string, string>;
  signature: string;
}): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !input.signature) return false;

  const payload =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((key) => key + input.params[key])
      .join("");
  const expected = crypto.createHmac("sha1", token).update(payload, "utf8").digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Exposed so the signature can be produced in tests and local tooling. */
export function signPayload(url: string, params: Record<string, string>, token: string): string {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("");
  return crypto.createHmac("sha1", token).update(payload, "utf8").digest("base64");
}
