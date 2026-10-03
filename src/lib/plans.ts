// Plan skeleton: limits enforced at the API layer. Billing wiring comes in a
// later phase; the "plan" string on Workspace is the single source of truth.

export type PlanId = "free" | "starter" | "scale" | "agency";

export interface PlanLimits {
  label: string;
  maxEmailAccounts: number;
  maxMembers: number;
  maxDailyEmailsPerAccount: number;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    label: "Free",
    maxEmailAccounts: 2,
    maxMembers: 2,
    maxDailyEmailsPerAccount: 30,
  },
  starter: {
    label: "Starter",
    maxEmailAccounts: 10,
    maxMembers: 3,
    maxDailyEmailsPerAccount: 50,
  },
  scale: {
    label: "Scale",
    maxEmailAccounts: 100,
    maxMembers: 25,
    maxDailyEmailsPerAccount: 100,
  },
  agency: {
    label: "Agency",
    maxEmailAccounts: 1000,
    maxMembers: 100,
    maxDailyEmailsPerAccount: 200,
  },
};

export function planLimits(plan: string): PlanLimits {
  return PLANS[(plan as PlanId) in PLANS ? (plan as PlanId) : "free"];
}
