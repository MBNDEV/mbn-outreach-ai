import "server-only";
import { db } from "@/lib/db";

// Workspace memory is what the agent knows about the business it sells for.
// Records are small and typed by kind so the generation prompt can be assembled
// deterministically — and so a user can disable one line without deleting it.

export const MEMORY_KINDS = [
  {
    id: "business",
    label: "Business",
    hint: "What the company does, in a sentence or two.",
  },
  { id: "offer", label: "Offer", hint: "One service or package you sell." },
  { id: "icp", label: "Ideal customer", hint: "One customer profile worth targeting." },
  {
    id: "rule",
    label: "Guidance",
    hint: "A rule the agent must follow, e.g. never quote prices.",
  },
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number]["id"];

export function isMemoryKind(value: string): value is MemoryKind {
  return MEMORY_KINDS.some((kind) => kind.id === value);
}

export interface MemoryContext {
  business: string;
  offers: string[];
  icps: string[];
  rules: string[];
  complete: boolean;
}

/** Enabled memory, grouped for prompt assembly. */
export async function memoryContext(workspaceId: string): Promise<MemoryContext> {
  const records = await db.memoryRecord.findMany({
    where: { workspaceId, enabled: true },
    orderBy: { createdAt: "asc" },
  });
  const of = (kind: MemoryKind) =>
    records.filter((record) => record.kind === kind).map((record) => record.content);

  const business = of("business").join(" ");
  const offers = of("offer");
  const icps = of("icp");
  return {
    business,
    offers,
    icps,
    rules: of("rule"),
    // Copy cannot be written without knowing the business, what it sells, and
    // who it sells to. Anything less and the agent should say so, not guess.
    complete: Boolean(business) && offers.length > 0 && icps.length > 0,
  };
}

/** The audience line handed to sequence generation. */
export function audienceFrom(context: MemoryContext, agentIcp: string): string {
  const parts = [agentIcp.trim(), ...context.icps].filter(Boolean);
  return parts.join(". ");
}

/** Guidance rules appended to the generation brief verbatim, because a user who
 *  writes "never mention price" means exactly that. */
export function briefFrom(context: MemoryContext): { business: string; offer: string } {
  const business = [
    context.business,
    context.rules.length > 0 ? `Rules you must follow: ${context.rules.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { business, offer: context.offers.join("; ") };
}
