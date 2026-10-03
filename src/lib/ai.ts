import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Claude wrapper for the one-shot AI features. All of them degrade
// gracefully: when ANTHROPIC_API_KEY is unset, callers fall back to
// heuristics or hide the UI. The copilot's tool-use loop lives in
// lib/copilot/runtime.ts.

const GENERATION_MODEL = "claude-sonnet-5";
const CLASSIFY_MODEL = "claude-haiku-4-5-20251001";

export function aiAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function complete(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  return response.content.find((block) => block.type === "text")?.text ?? "";
}

function extractJson<T>(text: string): T {
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) throw new Error("Model returned no JSON.");
  return JSON.parse(match[0]) as T;
}

export interface GeneratedSequence {
  steps: Array<{ waitDays: number; subject: string; body: string }>;
}

export async function generateSequence(input: {
  business: string;
  offer: string;
  audience: string;
  stepCount: number;
}): Promise<GeneratedSequence> {
  const text = await complete({
    model: GENERATION_MODEL,
    maxTokens: 2500,
    system: `You write cold email sequences for a B2B outreach tool.
Rules: under 100 words per email, consultative tone, lead with the prospect's
outcome, one clear call to action, no hype, no fabricated statistics or
invented case studies. Personalize with {{first_name|there}} and {{company}}
variables; you may use {{RANDOM|a|b}} spintax for greetings. Follow-up
subjects may be empty strings (they thread as "Following up").
Respond with ONLY JSON: {"steps":[{"waitDays":number,"subject":string,"body":string}]}.
waitDays is the delay BEFORE that step (first step 0).`,
    user: `Business: ${input.business}\nOffer: ${input.offer}\nTarget audience: ${input.audience}\nWrite a ${input.stepCount}-step sequence.`,
  });
  const parsed = extractJson<GeneratedSequence>(text);
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new Error("Model returned an empty sequence.");
  }
  return parsed;
}

const LABELS = [
  "interested",
  "meeting_booked",
  "not_interested",
  "wrong_person",
  "out_of_office",
  "lead",
] as const;

export async function classifyReply(input: {
  subject: string;
  body: string;
}): Promise<(typeof LABELS)[number]> {
  const text = await complete({
    model: CLASSIFY_MODEL,
    maxTokens: 200,
    system: `Classify a reply to a cold sales email. Respond with ONLY JSON:
{"label": one of ${JSON.stringify(LABELS)}}.
"interested" = wants to know more or asks questions about the offer;
"meeting_booked" = proposes or confirms a time; "not_interested" = declines;
"wrong_person" = redirects to someone else; "out_of_office" = auto-reply;
"lead" = anything else.`,
    user: `Subject: ${input.subject}\n\n${input.body.slice(0, 2000)}`,
  });
  const parsed = extractJson<{ label: string }>(text);
  return (LABELS as readonly string[]).includes(parsed.label)
    ? (parsed.label as (typeof LABELS)[number])
    : "lead";
}

export interface SearchFilterDraft {
  titles: string[];
  seniorities: string[];
  industries: string[];
  locations: string[];
  companySizes: string[];
  keywords: string;
}

/**
 * Natural language to the lead-search filter DSL. The allowed enum values are
 * passed in rather than hard-coded here so the DSL stays the single source of
 * truth — a new seniority or size bracket needs no change to this prompt.
 */
export async function draftSearchFilter(input: {
  request: string;
  seniorities: readonly string[];
  companySizes: readonly string[];
}): Promise<SearchFilterDraft> {
  const text = await complete({
    model: CLASSIFY_MODEL,
    maxTokens: 700,
    system: `Turn a description of an ideal customer into B2B people-search filters.
Respond with ONLY JSON:
{"titles":string[],"seniorities":string[],"industries":string[],"locations":string[],"companySizes":string[],"keywords":string}
- titles: specific job titles to match, lowercase.
- seniorities: only values from ${JSON.stringify(input.seniorities)}; omit if unclear.
- industries: short industry keywords, lowercase, e.g. "plumbing", "dental".
- locations: places as "City, State" or "Country".
- companySizes: only values from ${JSON.stringify(input.companySizes)} (employee ranges).
- keywords: anything left over as free text, or "".
Leave an array empty rather than guessing. Never invent a location that was not implied.`,
    user: input.request.slice(0, 1000),
  });
  const parsed = extractJson<Partial<SearchFilterDraft>>(text);
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  const allowed = (value: unknown, valid: readonly string[]): string[] =>
    strings(value).filter((v) => valid.includes(v));
  return {
    titles: strings(parsed.titles),
    seniorities: allowed(parsed.seniorities, input.seniorities),
    industries: strings(parsed.industries),
    locations: strings(parsed.locations),
    companySizes: allowed(parsed.companySizes, input.companySizes),
    keywords: typeof parsed.keywords === "string" ? parsed.keywords : "",
  };
}
