"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireWorkspace, requireRole } from "@/lib/auth";
import { searchDomains, domainPriceCents, mailboxPriceCents } from "@/lib/marketplace/providers";
import { dnsPlan, type MailProvider, MAIL_PROVIDERS } from "@/lib/marketplace/dns";
import { runProvisioningTick, recheckDomain, connectMailbox } from "@/lib/marketplace/provision";
import { billingAvailable } from "@/lib/billing";
import type { FormState } from "@/lib/actions/auth";
import type { DomainSuggestion } from "@/lib/marketplace/providers";

export interface SearchState extends FormState {
  seed?: string;
  results?: DomainSuggestion[];
}

export async function searchDomainsAction(
  _prev: SearchState,
  formData: FormData
): Promise<SearchState> {
  try {
    await requireWorkspace();
    const seed = String(formData.get("seed") ?? "").trim();
    if (!seed) return { error: "Type a brand or word to build names from." };
    return { seed, results: await searchDomains(seed) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

function localPart(index: number, first: string): string {
  const base = first.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (base) return index === 0 ? base : `${base}${index + 1}`;
  return index === 0 ? "hello" : `hello${index + 1}`;
}

export interface OrderState extends FormState {
  orderId?: string;
  message?: string;
}

/**
 * Place an order. A bring-your-own domain starts provisioning immediately
 * (nothing is being sold); anything we would register or host goes through
 * checkout first, so the product never buys on someone's behalf unprompted.
 */
export async function createOrderAction(
  _prev: OrderState,
  formData: FormData
): Promise<OrderState> {
  let checkoutUrl = "";
  try {
    const { workspace } = await requireRole("admin");

    const domainName = String(formData.get("domain") ?? "").trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domainName)) {
      return { error: "That doesn't look like a domain name." };
    }
    const source = String(formData.get("source") ?? "byo") === "registrar" ? "registrar" : "byo";
    const mailProvider = String(formData.get("mailProvider") ?? "smtp") as MailProvider;
    if (!MAIL_PROVIDERS.some((p) => p.id === mailProvider)) {
      return { error: "Pick a mail provider." };
    }
    const mailboxCount = Math.max(1, Math.min(10, Number(formData.get("mailboxes") ?? 1) || 1));
    const firstName = String(formData.get("firstName") ?? "").trim();
    const lastName = String(formData.get("lastName") ?? "").trim();

    const existing = await db.managedDomain.findFirst({
      where: { workspaceId: workspace.id, name: domainName },
    });
    if (existing) return { error: "That domain is already in this workspace." };

    const amountCents =
      (source === "registrar" ? domainPriceCents() : 0) + mailboxCount * mailboxPriceCents();
    const payable = source === "registrar" && billingAvailable();

    const domain = await db.managedDomain.create({
      data: {
        workspaceId: workspace.id,
        name: domainName,
        source,
        mailProvider,
        status: "pending",
        dnsRecords: JSON.stringify(
          dnsPlan(domainName, mailProvider, process.env.APP_URL ?? "http://localhost:3000")
        ),
      },
    });

    await db.managedMailbox.createMany({
      data: Array.from({ length: mailboxCount }, (_, index) => ({
        workspaceId: workspace.id,
        domainId: domain.id,
        email: `${localPart(index, firstName)}@${domainName}`,
        firstName,
        lastName,
      })),
    });

    const order = await db.marketplaceOrder.create({
      data: {
        workspaceId: workspace.id,
        domainName,
        source,
        mailboxCount,
        amountCents,
        status: payable ? "awaiting_payment" : "paid",
      },
    });

    if (payable) {
      const { marketplaceCheckoutUrl } = await import("@/lib/billing");
      checkoutUrl = await marketplaceCheckoutUrl(workspace, order.id, domainName, mailboxCount);
      await db.marketplaceOrder.update({
        where: { id: order.id },
        data: { stripeSessionId: checkoutUrl.slice(0, 200) },
      });
    } else {
      // Nothing to charge for, so provisioning can start on the spot.
      await runProvisioningTick();
    }

    revalidatePath("/marketplace");
    if (!checkoutUrl) {
      return {
        orderId: order.id,
        message:
          source === "byo"
            ? "Added. Set the DNS records below, then check them — mailboxes connect once they resolve."
            : "Order recorded.",
      };
    }
  } catch (err) {
    return { error: (err as Error).message };
  }
  // redirect() throws, so it runs outside the try that reports errors.
  redirect(checkoutUrl);
}

export async function recheckDomainAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const { workspace } = await requireWorkspace();
    const message = await recheckDomain(workspace.id, String(formData.get("domainId") ?? ""));
    revalidatePath("/marketplace");
    return { error: message };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Bring-your-own path: the user pastes the mailbox's credentials and we
 *  verify them before calling it ready. */
export async function connectMailboxAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    const { workspace } = await requireRole("admin");
    const mailboxId = String(formData.get("mailboxId") ?? "");
    const mailbox = await db.managedMailbox.findFirst({
      where: { id: mailboxId, workspaceId: workspace.id },
    });
    if (!mailbox) return { error: "Mailbox not found." };

    const password = String(formData.get("password") ?? "");
    const smtpHost = String(formData.get("smtpHost") ?? "").trim();
    const imapHost = String(formData.get("imapHost") ?? "").trim();
    if (!password || !smtpHost || !imapHost) {
      return { error: "SMTP host, IMAP host and password are all required." };
    }

    const result = await connectMailbox(mailbox.id, {
      kind: "smtp",
      smtpHost,
      smtpPort: Number(formData.get("smtpPort") ?? 587) || 587,
      imapHost,
      imapPort: Number(formData.get("imapPort") ?? 993) || 993,
      username: String(formData.get("username") ?? "").trim() || mailbox.email,
      password,
    });
    revalidatePath("/marketplace");
    revalidatePath("/accounts");
    return result.ok ? {} : { error: result.error };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function removeDomainAction(formData: FormData): Promise<void> {
  const { workspace } = await requireRole("admin");
  // Deleting the record here does not delete the domain at a registrar, nor
  // the EmailAccounts already connected from it — those are the user's.
  await db.managedDomain.deleteMany({
    where: { id: String(formData.get("domainId") ?? ""), workspaceId: workspace.id },
  });
  revalidatePath("/marketplace");
}
