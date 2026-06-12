import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { mustSubscribeToContinue } from "@/lib/mustSubscribeToContinue";
import { getSubscriptionStatus } from "@/lib/subscriptionStatus";

function normalizePath(pathname: string | null | undefined): string {
  if (!pathname?.trim()) return "/";
  const t = pathname.trim();
  if (t === "/") return "/";
  return t.length > 1 && t.endsWith("/") ? t.slice(0, -1) : t;
}

function isProfilePlanTabPath(path: string): boolean {
  const n = normalizePath(path);
  if (n.includes("profile-preview")) return false;
  if (n.includes("app-store-screenshots")) return false;
  const segments = n.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  return last === "profile";
}

function isPaywallAllowedRoute(path: string): boolean {
  const n = normalizePath(path);
  if (n === "/" || n === "/index") return true;
  if (n === "/login" || n === "/register" || n === "/forgot-password") return true;
  if (n.startsWith("/auth")) return true;
  if (n === "/onboarding") return true;
  if (n === "/paywall") return true;
  if (n === "/platform-flow-preview") return true;
  if (n.startsWith("/app-store-screenshots")) return true;
  if (isProfilePlanTabPath(n)) return true;
  return false;
}

/**
 * After platform trial, freelancer/company users must subscribe before using product surfaces.
 * iOS: RevenueCat App Store subscription; Android/web: Stripe (metadata).
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
        .select("role, trial_ends_at, beta_invite, created_at, beta_access_days, subscription_tier")
        .eq("id", user.id)
        .maybeSingle();

      let companyPlan: string | null = null;
      const role = String(pr?.role ?? "").toLowerCase();
      if (role === "company") {
        const { data: cp } = await supabase
          .from("company_profiles")
          .select("subscription_plan")
          .eq("id", user.id)
          .maybeSingle();
        companyPlan = (cp as { subscription_plan?: string } | null)?.subscription_plan ?? null;
      }

      const status = await getSubscriptionStatus({
        user,
        profile: pr,
        companySubscriptionPlan: companyPlan,
      });

      if (cancelled) return;

      if (status.isSubscribed) {
        setPaywall(false);
        return;
      }

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
    if (Platform.OS === "ios") {
      router.replace("/paywall");
      return;
    }
    router.replace("/(tabs)/profile");
  }, [paywall, pathname, router]);

  return null;
}
