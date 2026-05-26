import type { User } from "@supabase/supabase-js";
import { resolveAppRole, isCeoProfile } from "@/lib/profileRole";

export type ProfileSubscriptionGateRow = {
  role?: string | null;
  trial_ends_at?: string | null;
  beta_invite?: boolean | null;
  created_at?: string | null;
  beta_access_days?: number | null;
};

function hasStripeSubscriptionInMetadata(user: User): boolean {
  const m = user.user_metadata as Record<string, unknown> | undefined;
  const id = m?.stripe_subscription_id;
  return typeof id === "string" && id.trim().length > 0;
}

/**
 * Same rules as crea-services `mustSubscribeToContinue` — no global paywall after trial.
 * Freelancers and companies use Free tier with contextual Pro upgrades.
 */
export function mustSubscribeToContinue(user: User, profile: ProfileSubscriptionGateRow | null | undefined): boolean {
  if (hasStripeSubscriptionInMetadata(user)) return false;

  const resolvedRole = resolveAppRole(profile?.role, user);
  if (isCeoProfile(resolvedRole)) return false;

  const role = String(resolvedRole ?? "").toLowerCase();
  if (role === "freelancer" || role === "company") return false;

  return false;
}
