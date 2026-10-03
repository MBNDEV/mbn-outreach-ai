// The lead-search filter DSL: the product's own shape, not a provider's. Saved
// searches store it, the search UI builds it, AI search will emit it, and each
// provider adapter in leadsearch.ts translates it. Kept free of server-only
// imports because the search form is a client component.

export interface LeadFilter {
  titles: string[];
  seniorities: string[];
  industries: string[];
  locations: string[];
  companySizes: string[]; // e.g. "11,50"
  keywords: string;
  page: number;
}

export interface FoundLead {
  /** The provider's own id for this person, used to reveal the address at
   *  import. A row without one can be read but never imported. */
  providerId: string;
  /** Empty until the row is revealed — search results carry no address. */
  email: string;
  firstName: string;
  lastName: string;
  title: string;
  company: string;
  location: string;
  linkedinUrl: string;
  /** The provider has an address on file for this person. Revealing it costs a
   *  call and a credit, so it happens at import, not while browsing. */
  emailAvailable: boolean;
}

export const SENIORITIES = ["owner", "founder", "c_suite", "vp", "director", "manager"];

export const COMPANY_SIZES = [
  { value: "1,10", label: "1–10" },
  { value: "11,50", label: "11–50" },
  { value: "51,200", label: "51–200" },
  { value: "201,500", label: "201–500" },
  { value: "501,1000", label: "501–1000" },
  { value: "1001,5000", label: "1001–5000" },
];

export function emptyFilter(): LeadFilter {
  return {
    titles: [],
    seniorities: [],
    industries: [],
    locations: [],
    companySizes: [],
    keywords: "",
    page: 1,
  };
}

/** Tolerant of partial or legacy JSON so a saved search never breaks the page. */
export function parseFilter(raw: string): LeadFilter {
  const base = emptyFilter();
  try {
    const parsed = JSON.parse(raw) as Partial<LeadFilter>;
    return {
      titles: parsed.titles ?? base.titles,
      seniorities: parsed.seniorities ?? base.seniorities,
      industries: parsed.industries ?? base.industries,
      locations: parsed.locations ?? base.locations,
      companySizes: parsed.companySizes ?? base.companySizes,
      keywords: parsed.keywords ?? base.keywords,
      page: parsed.page ?? base.page,
    };
  } catch {
    return base;
  }
}

export function filterFromForm(formData: FormData): LeadFilter {
  const list = (key: string): string[] =>
    String(formData.get(key) ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  return {
    titles: list("titles"),
    seniorities: formData.getAll("seniorities").map(String),
    industries: list("industries"),
    locations: list("locations"),
    companySizes: formData.getAll("companySizes").map(String),
    keywords: String(formData.get("keywords") ?? "").trim(),
    page: Math.max(1, Number(formData.get("page") ?? 1) || 1),
  };
}

export function filterIsEmpty(filter: LeadFilter): boolean {
  return (
    filter.titles.length === 0 &&
    filter.seniorities.length === 0 &&
    filter.industries.length === 0 &&
    filter.locations.length === 0 &&
    filter.companySizes.length === 0 &&
    filter.keywords.trim() === ""
  );
}
