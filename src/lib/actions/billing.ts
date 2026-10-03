"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { PLANS, type PlanId } from "@/lib/plans";
import {
  billingAvailable,
  planCheckoutUrl,
  creditCheckoutUrl,
  billingPortalUrl,
} from "@/lib/billing";
import type { FormState } from "@/lib/actions/auth";

export async function startPlanCheckoutAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  let url: string;
  try {
    const { workspace } = await requireRole("owner");
    if (!billingAvailable()) {
      return { error: "Set STRIPE_SECRET_KEY and the plan price IDs to enable checkout." };
    }
    const plan = String(formData.get("plan") ?? "") as PlanId;
    if (!(plan in PLANS) || plan === "free") return { error: "Pick a paid plan." };
    url = await planCheckoutUrl(workspace, plan);
  } catch (err) {
    return { error: (err as Error).message };
  }
  // redirect() throws, so it must run outside the try that reports errors.
  redirect(url);
}

export async function startCreditCheckoutAction(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  let url: string;
  try {
    const { workspace } = await requireRole("admin");
    if (!billingAvailable()) {
      return { error: "Set STRIPE_SECRET_KEY and STRIPE_PRICE_CREDITS to buy credits." };
    }
    url = await creditCheckoutUrl(workspace, Number(formData.get("packs") ?? 1) || 1);
  } catch (err) {
    return { error: (err as Error).message };
  }
  redirect(url);
}

export async function openBillingPortalAction(
  _prev: FormState,
  _formData: FormData
): Promise<FormState> {
  let url: string;
  try {
    const { workspace } = await requireRole("owner");
    if (!billingAvailable()) return { error: "Billing is not configured." };
    if (!workspace.stripeCustomerId) {
      return { error: "No Stripe customer yet — start a plan checkout first." };
    }
    url = await billingPortalUrl(workspace.stripeCustomerId);
  } catch (err) {
    return { error: (err as Error).message };
  }
  redirect(url);
}
