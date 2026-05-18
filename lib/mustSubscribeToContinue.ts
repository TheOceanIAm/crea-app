import type { User } from "@supabase/supabase-js";
import { isWithinPlatformTrialPeriod } from "@/lib/platformTrial";
import { resolveAppRole, isCeoProfile } from "@/lib/profileRole";

/** Match crea-services `PLATFORM_TRIAL_FALLBACK_DAYS` when `trial_ends_at` is missing. */
const PLATFORM_TRIAL_FALLBACK_DAYS = 60;

/** Default complimentary beta window when `profiles.beta_access_days` is null (same as web). */
const BETA_ACCESS_TRIAL_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export type ProfileSubscriptionGateRow = {
  role?: string | null;
  trial_ends_at?: string | null;
  beta_invite?: boolean | null;
  created_at?: string | null;
  beta_access_days?: number | null;
};

function daysSinceAccountCreated(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / MS_PER_DAY;
}

function hasStripeSubscriptionInMetadata(user: User): boolean {
  const m = user.user_metadata as Record<string, unknown> | undefined;
  const id = m?.stripe_subscription_id;
  return typeof id === "string" && id.trim().length > 0;
}

function isBetaInviteUser(user: User, profileBetaInvite?: boolean | null): boolean {
  const m = user.user_metadata as Record<string, unknown> | undefined;
  if (m?.beta_invite === true || m?.beta_invite === "true") return true;
  return profileBetaInvite === true;
}

function effectiveBetaAccessDays(profileBetaAccessDays: number | null | undefined): number {
  if (
    typeof profileBetaAccessDays === "number" &&
    Number.isFinite(profileBetaAccessDays) &&
    profileBetaAccessDays >= 1
  ) {
    return Math.min(730, Math.max(1, Math.floor(profileBetaAccessDays)));
  }
  return BETA_ACCESS_TRIAL_DAYS;
}

function betaAccessTrialStartIso(
  profileCreatedAt: string | null | undefined,
  userCreatedAt: string | null | undefined
): string | null {
  const a = profileCreatedAt?.trim();
  if (a) return a;
  const b = userCreatedAt?.trim();
  return b || null;
}

function isBetaAccessTrialActive(params: {
  profileCreatedAt: string | null | undefined;
  userCreatedAt: string | null | undefined;
  betaAccessDays?: number | null;
}): boolean {
  const start = betaAccessTrialStartIso(params.profileCreatedAt, params.userCreatedAt);
  if (!start) return true;
  const t = new Date(start).getTime();
  if (Number.isNaN(t)) return true;
  const days = effectiveBetaAccessDays(params.betaAccessDays);
  const end = t + days * MS_PER_DAY;
  return Date.now() < end;
}

/**
 * Same rules as crea-services `mustSubscribeToContinue` — mobile shell paywall.
 */
export function mustSubscribeToContinue(user: User, profile: ProfileSubscriptionGateRow | null | undefined): boolean {
  if (hasStripeSubscriptionInMetadata(user)) return false;

  const resolvedRole = resolveAppRole(profile?.role, user);
  if (isCeoProfile(resolvedRole)) return false;

  const role = String(resolvedRole ?? "").toLowerCase();
  if (role !== "freelancer" && role !== "company") return false;

  if (
    isBetaInviteUser(user, profile?.beta_invite) &&
    isBetaAccessTrialActive({
      profileCreatedAt: profile?.created_at,
      userCreatedAt: user.created_at,
      betaAccessDays: profile?.beta_access_days,
    })
  ) {
    return false;
  }

  const endsRaw = profile?.trial_ends_at;
  if (typeof endsRaw === "string" && endsRaw.trim()) {
    if (isWithinPlatformTrialPeriod(endsRaw, user.created_at ?? null)) return false;
    return true;
  }

  const days = daysSinceAccountCreated(profile?.created_at ?? user.created_at);
  if (days === null) return false;
  return days >= PLATFORM_TRIAL_FALLBACK_DAYS;
}
