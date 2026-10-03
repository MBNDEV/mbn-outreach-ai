import "server-only";

// Provider adapters for lead search. Swapping Apollo for PDL should touch only
// this file — the filter DSL and everything built on it lives in leadfilter.ts.
//
// Apollo splits the job in two: api_search finds people but deliberately
// returns no addresses, and people/bulk_match reveals them for the rows the
// user actually wants. So searching is free and listing is safe, while the
// reveal happens at import — which is where we already charge a credit.

import type { LeadFilter, FoundLead } from "@/lib/leadfilter";

const APOLLO_BASE = "https://api.apollo.io/api/v1";

export interface SearchOutcome {
  leads: FoundLead[];
  total: number;
  provider: string;
}

export function searchProvider(): "apollo" | null {
  return process.env.APOLLO_API_KEY ? "apollo" : null;
}

function apolloHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "x-api-key": process.env.APOLLO_API_KEY ?? "",
  };
}

interface ApolloSearchPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  // The search endpoint masks surnames; the full name only arrives on reveal.
  last_name_obfuscated?: string;
  title?: string;
  has_email?: boolean;
  organization?: { name?: string };
}

/** api_search takes its filters in the query string, and repeats `key[]` for
 *  each value of a multi-select. */
function searchQuery(filter: LeadFilter): URLSearchParams {
  const query = new URLSearchParams();
  query.set("page", String(filter.page));
  query.set("per_page", "25");

  const list = (key: string, values: string[]): void => {
    for (const value of values) query.append(`${key}[]`, value);
  };
  list("person_titles", filter.titles);
  list("person_seniorities", filter.seniorities);
  list("person_locations", filter.locations);
  list("organization_num_employees_ranges", filter.companySizes);

  // This endpoint has no organization-keyword parameter, so industries ride
  // along as free text rather than being silently dropped.
  const keywords = [filter.keywords, ...filter.industries].filter(Boolean).join(" ");
  if (keywords) query.set("q_keywords", keywords);

  return query;
}

async function searchApollo(filter: LeadFilter): Promise<SearchOutcome> {
  const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search?${searchQuery(filter)}`, {
    method: "POST",
    headers: apolloHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`Apollo search failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    people?: ApolloSearchPerson[];
    total_entries?: number;
  };

  const leads: FoundLead[] = (data.people ?? []).map((person) => ({
    providerId: person.id ?? "",
    email: "",
    firstName: person.first_name ?? "",
    lastName: person.last_name ?? person.last_name_obfuscated ?? "",
    title: person.title ?? "",
    company: person.organization?.name ?? "",
    // Search reports only whether a city exists, never which one; the reveal
    // call fills this in.
    location: "",
    linkedinUrl: "",
    // Without an id there is nothing to reveal against, so the row cannot be
    // imported however promising it looks.
    emailAvailable: Boolean(person.has_email) && Boolean(person.id),
  }));

  return { leads, total: data.total_entries ?? leads.length, provider: "apollo" };
}

export async function searchLeads(filter: LeadFilter): Promise<SearchOutcome> {
  const provider = searchProvider();
  if (!provider) {
    throw new Error(
      "Lead search needs a data partner: set APOLLO_API_KEY in .env to enable it."
    );
  }
  return searchApollo(filter);
}

interface ApolloMatch {
  id?: string;
  email?: string;
  email_status?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: { name?: string };
}

/** bulk_match takes at most 10 people per call. */
const REVEAL_CHUNK = 10;

async function revealChunk(ids: string[]): Promise<ApolloMatch[]> {
  const res = await fetch(`${APOLLO_BASE}/people/bulk_match`, {
    method: "POST",
    headers: apolloHeaders(),
    body: JSON.stringify({ details: ids.map((id) => ({ id })) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Apollo reveal failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { matches?: ApolloMatch[] };
  return data.matches ?? [];
}

/** Fill in the addresses (and the details search withholds) for chosen rows.
 *  Rows the provider cannot match come back unchanged and without an email, so
 *  the caller skips them rather than importing a blank lead. */
export async function revealLeads(rows: FoundLead[]): Promise<FoundLead[]> {
  if (!searchProvider()) {
    throw new Error(
      "Lead search needs a data partner: set APOLLO_API_KEY in .env to enable it."
    );
  }
  const ids = rows.map((row) => row.providerId).filter(Boolean);
  if (ids.length === 0) return rows;

  const matches = new Map<string, ApolloMatch>();
  for (let i = 0; i < ids.length; i += REVEAL_CHUNK) {
    for (const match of await revealChunk(ids.slice(i, i + REVEAL_CHUNK))) {
      if (match.id) matches.set(match.id, match);
    }
  }

  return rows.map((row) => {
    const match = matches.get(row.providerId);
    if (!match?.email) return row;
    return {
      ...row,
      email: match.email,
      emailAvailable: true,
      // The reveal is the better record: search gave us a masked surname and no
      // location at all.
      firstName: match.first_name || row.firstName,
      lastName: match.last_name || row.lastName,
      title: match.title || row.title,
      company: match.organization?.name || row.company,
      location: [match.city, match.state, match.country].filter(Boolean).join(", ") || row.location,
      linkedinUrl: match.linkedin_url || row.linkedinUrl,
    };
  });
}
