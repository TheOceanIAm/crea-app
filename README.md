# CREA App (iOS / Expo)

React Native app (Expo SDK 52, expo-router). Uses the same Supabase project as the web app.

**Repo path:** `/Users/hendrik/Desktop/crea-app`  
**Web backend:** `../crea-services`

## Pricing (2-tier: Free \| Pro)

Catalog prices: `lib/planCatalogPrices.ts` — must match `../crea-services/lib/company-plan-catalog-prices.ts`.

- **Freelancer Pro:** €8.99/mo, €59.99/yr (iOS: RevenueCat; Android: Stripe via web)
- **Company Pro:** €89/mo, €649.99/yr

## Auth UX (aligned with web homepage)

- **Login:** production hero → Sign up / Log in (form on demand)
- **Onboarding:** role + profile after signup
- No separate design preview routes in the app

## Local dev

Requires **Node 20** (`.nvmrc`):

```bash
nvm use 20
npm run dev          # Metro + Expo
npm run dev:ios      # iOS simulator
```

Env: copy `.env.example` → `.env` — set `EXPO_PUBLIC_SUPABASE_*` and `EXPO_PUBLIC_CREA_WEB_URL` (e.g. `https://www.creaservices.de`).

## Supabase

Run SQL/migrations from **crea-services** first. This repo only carries a subset for app-specific functions (`notify-message-push`, etc.).

## Subscription parity

See `docs/web-app-subscription-parity.md` for rules shared with the web app.
