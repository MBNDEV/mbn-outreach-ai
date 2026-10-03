"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/auth";
import { spendCredits } from "@/lib/credits";
import { searchLeads, revealLeads } from "@/lib/leadsearch";
import {
  filterFromForm,
  filterIsEmpty,
  SENIORITIES,
  COMPANY_SIZES,
  type FoundLead,
  type LeadFilter,
} from "@/lib/leadfilter";
import type { FormState } from "@/lib/actions/auth";

export interface SearchState extends FormState {
  leads?: FoundLead[];
  total?: number;
  filter?: LeadFilter;
  message?: string;
}

export async function searchLeadsAction(
  _prev: SearchState,
  formData: FormData
): Promise<SearchState> {
  try {
    await requireWorkspace();
    const filter = filterFromForm(formData);
    if (filterIsEmpty(filter)) {
      return { error: "Add at least one filter before searching." };
    }
    const outcome = await searchLeads(filter);
    return { leads: outcome.leads, total: outcome.total, filter };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Import charges one credit per row that carries an address — searching and
 *  browsing stay free, matching how the enrichment waterfall already bills.
 *  The provider withholds addresses from search results, so this is also where
 *  they get revealed: only the chosen rows cost anything. */
export async function importFoundLeadsAction(
  _prev: SearchState,
  formData: FormData
): Promise<SearchState> {
  try {
    const { workspace } = await requireWorkspace();
    let rows: FoundLead[];
    try {
      rows = JSON.parse(String(formData.get("leads") ?? "[]")) as FoundLead[];
    } catch {
      return { error: "Could not read the selected rows." };
    }
    if (rows.length === 0) return { error: "Select at least one row to import." };

    const revealed = await revealLeads(rows);
    const importable = revealed.filter((row) => row.email);
    if (importable.length === 0) {
      return { error: "The provider returned no address for any of the selected rows." };
    }

    const listName = String(formData.get("listName") ?? "").trim();
    const list = listName
      ? await db.leadList.upsert({
          where: { workspaceId_name: { workspaceId: workspace.id, name: listName } },
          create: { workspaceId: workspace.id, name: listName },
          update: {},
        })
      : null;

    let imported = 0;
    let charged = 0;
    for (const row of importable) {
      const email = row.email.trim().toLowerCase();
      const existing = await db.lead.findUnique({
        where: { workspaceId_email: { workspaceId: workspace.id, email } },
      });
      // Re-importing a row already paid for must not charge twice.
      if (!existing) {
        try {
          await spendCredits(workspace.id, 1, `Lead import: ${email}`);
        } catch {
          return {
            message: `Imported ${imported} lead${imported === 1 ? "" : "s"} before running out of credits.`,
          };
        }
        charged += 1;
      }
      const lead = await db.lead.upsert({
        where: { workspaceId_email: { workspaceId: workspace.id, email } },
        create: {
          workspaceId: workspace.id,
          email,
          firstName: row.firstName,
          lastName: row.lastName,
          company: row.company,
          title: row.title,
          customFields: JSON.stringify({
            location: row.location,
            linkedin_url: row.linkedinUrl,
            source: "lead search",
          }),
        },
        update: {
          firstName: row.firstName || undefined,
          lastName: row.lastName || undefined,
          company: row.company || undefined,
          title: row.title || undefined,
        },
      });
      if (list) {
        await db.leadListItem
          .create({ data: { listId: list.id, leadId: lead.id } })
          .catch(() => {}); // already on the list
      }
      imported += 1;
    }

    revalidatePath("/leads");
    return {
      message: `Imported ${imported} lead${imported === 1 ? "" : "s"}${
        list ? ` into “${list.name}”` : ""
      } · ${charged} credit${charged === 1 ? "" : "s"} spent.`,
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function saveSearchAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const name = String(formData.get("name") ?? "").trim();
  const filter = String(formData.get("filter") ?? "{}");
  if (!name) return;
  await db.savedSearch.upsert({
    where: { workspaceId_name: { workspaceId: workspace.id, name } },
    create: { workspaceId: workspace.id, name, filter },
    update: { filter },
  });
  revalidatePath("/leads/search");
}

export async function deleteSearchAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  await db.savedSearch.deleteMany({
    where: { id: String(formData.get("id") ?? ""), workspaceId: workspace.id },
  });
  revalidatePath("/leads/search");
}

export interface AiFilterState extends FormState {
  filter?: LeadFilter;
}

export async function draftFilterAction(
  _prev: AiFilterState,
  formData: FormData
): Promise<AiFilterState> {
  try {
    await requireWorkspace();
    const request = String(formData.get("request") ?? "").trim();
    if (!request) return { error: "Describe who you are looking for." };

    const { aiAvailable, draftSearchFilter } = await import("@/lib/ai");
    if (!aiAvailable()) {
      return { error: "Set ANTHROPIC_API_KEY in .env to describe a search in plain English." };
    }
    const draft = await draftSearchFilter({
      request,
      seniorities: SENIORITIES,
      companySizes: COMPANY_SIZES.map((size) => size.value),
    });
    return { filter: { ...draft, page: 1 } };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
