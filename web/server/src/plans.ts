// What an account's plan allows (shared/plans.ts). A paid or trial plan holds
// until planUntil; after that the account is on Gratis without anything being
// rewritten. Admins get Creator's capacity.
import { PLANS, TRIAL_DAYS, type PlanId, type PlanLimits } from "../../shared/plans";
import type { User } from "./auth";

type PlanFields = Pick<User, "role" | "plan" | "planUntil">;

/** The plan in force now. */
export function planOf(u: PlanFields): PlanId {
  if (u.role === "admin") return "creator";
  return u.plan !== "free" && (!u.planUntil || u.planUntil.getTime() > Date.now()) ? u.plan : "free";
}

export const limitsOf = (u: PlanFields): PlanLimits => PLANS[planOf(u)].limits;

/** An account whose e-mail is not verified yet spends no LLM credits (accounts without e-mail predate sign-up). */
export const needsVerification = (u: Pick<User, "email" | "emailVerifiedAt">) => Boolean(u.email && !u.emailVerifiedAt);

/** Still inside the one Pro trial: the plan ends no later than the trial does. */
export function onTrial(u: PlanFields & Pick<User, "trialStartedAt">): boolean {
  return Boolean(
    u.trialStartedAt && u.planUntil && planOf(u) !== "free" && u.planUntil.getTime() - u.trialStartedAt.getTime() <= TRIAL_DAYS * 86_400_000 + 60_000,
  );
}

/** "Paket Gratis maksimal 3 notifikasi." and where to get more. */
export function capMessage(u: PlanFields, limit: number, what: string): string {
  const plan = planOf(u);
  return `Paket ${PLANS[plan].name} maksimal ${limit} ${what}.${plan === "creator" ? "" : " Naikkan paket di menu akun → Paket & tagihan."}`;
}

/** When a trial that starts now ends. */
export const trialEnd = () => new Date(Date.now() + TRIAL_DAYS * 86_400_000);
