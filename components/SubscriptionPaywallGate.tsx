import { useEffect, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { mustSubscribeToContinue } from "@/lib/mustSubscribeToContinue";

function normalizePath(pathname: string | null | undefined): string {
  if (!pathname?.trim()) return "/";
  const t = pathname.trim();
  if (t === "/") return "/";
  return t.length > 1 && t.endsWith("/") ? t.slice(0, -1) : t;
}

/** Main Profile tab (Plan & billing). Covers file route `/profile` and group segments like `/(tabs)/profile`. */
function isProfilePlanTabPath(path: string): boolean {
  const n = normalizePath(path);
  if (n.includes("profile-preview")) return false;
  const segments = n.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return last === "profile";
}

/** Routes that stay reachable without Stripe after platform trial (matches web paywall exemptions in spirit). */
function isPaywallAllowedRoute(path: string): boolean {
  const n = normalizePath(path);
  if (n === "/" || n === "/index") return true;
  if (n === "/login" || n === "/register" || n === "/forgot-password") return true;
  if (n.startsWith("/auth")) return true;
  if (n === "/onboarding") return true;
  if (isProfilePlanTabPath(n)) return true;
  return false;
}

/**
 * After platform trial, freelancer/company users must subscribe (Stripe) before using product surfaces.
 * Keeps auth/onboarding and the Profile tab reachable so they can complete checkout.
 */
export function SubscriptionPaywallGate() {
  const router = useRouter();
  const pathname = usePathname();
  const [paywall, setPaywall] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        setPaywall(false);
        return;
      }
      const { data: pr } = await supabase
        .from("profiles")
        .select("role, trial_ends_at, beta_invite, created_at, beta_access_days")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setPaywall(mustSubscribeToContinue(user, pr));
    };
    void run();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void run();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!paywall) return;
    const p = pathname ?? "";
    if (isPaywallAllowedRoute(p)) return;
    router.replace("/(tabs)/profile");
  }, [paywall, pathname, router]);

  return null;
}
