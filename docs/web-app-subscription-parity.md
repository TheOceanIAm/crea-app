# Web ↔ App: subscription logic & feature parity (1:1 reference)

This file is the **single source of truth** for marketing, website, and in-app messaging.  
**CEO role:** intentionally not end-user facing (admin); do not include in pricing/feature matrices.

---

## 1. Data sources (must match web & app)

| Field | Where | Usage |
|------|-------|-------|
| `profiles.role` | DB | `freelancer`, `company`, `ceo`, … |
| `auth.users.user_metadata.freelancer_plan` | JWT / Auth | `workspace` \| `starter` \| `pro` \| `premium` (default **`starter`** if missing/unknown) |
| `profiles.subscription_tier` | DB | Company tiers (see Sun Planner normalization in the app) |

**App helpers:** `lib/freelancerPlan.ts` (`resolveFreelancerPlanFromUser`, `isFreelancerWorkspaceOnlyPlan`, `isFreelancerStarterPlan`, `isFreelancerTalentPoolPlan`, `canFreelancerCreatePrivateProjects`).

---

## 2. Freelancer plans — matrix

| Plan | Create private projects (lead) | Talent pool | Tabs “Jobs / Messages / Alerts” | Income/stats on dashboard | Crew Pro features in project | Public freelancer calendar (overview) |
|------|-------------------------------|-------------|-----------------------------------|----------------------------|------------------------------|----------------------------------------|
| **Workspace** | Yes | No | **Hidden** (Home + profile only, plus any hidden routes) | No | **Manual** crew only (ADD CREW), **no** name search / external crew like Pro path | — (project may be limited) |
| **Starter** | **No** | No | Yes | Yes | Locked + **Pro** hint | Locked + **Pro** hint |
| **Pro** | Yes | Yes | Yes | Yes | Name search + external crew | Yes |
| **Premium** | Yes | Yes (same as Pro) | Yes | Yes | Same as Pro | Same as Pro |

**Important:** In the app **Pro** and **Premium** are **equal** for the talent pool (`isFreelancerTalentPoolPlan`). Differentiate Premium in **marketing** only, not via other gates — or add a dedicated feature later.

---

## 3. Private projects — definition & rules

- **Lead-owned private workspace:** `projects` row with `company_id = lead`, typically **`job_id` empty** (not from company job feed).
- **Starter:** **`canFreelancerCreatePrivateProjects`** = false → no new private lead projects (list/create locked; hint **Pro or Workspace**).
- **Workspace / Pro / Premium:** creation allowed.

**App entry points:** `canFreelancerCreatePrivateProjects`, `app/(tabs)/workspace-projects.tsx`, `app/(tabs)/dashboard.tsx`.

**Public profile — availability booking (company → freelancer):** No private project is created here. Only selection of an **existing active company job** (`jobs.status = 'active'`) — **app** (`BookFreelancerModal`) and **web** (`crea-services` → `FreelancerPublicCalendar` booking modal) stay aligned. The app sends structured booking DMs (`sendAvailabilityProjectInvite`); the web sends plain text — the DB resolves on accept (deep link or `Project:` line).

---

## 4. Sun planner & weather (production)

**Freelancer — product rules (marketing / pricing):**

| Plan | Weather (production) | Sun planner (production) |
|------|----------------------|---------------------------|
| **Workspace** | 14-day trial, then locked — workspace is **private organization** only, no talent pool / jobs / marketplace | 14-day trial, then locked — same window as weather |
| **Starter** | **Full access** | **14-day trial**; permanent full access with **Pro / Premium** |
| **Pro / Premium** | Full access | Full access |

**Company (`role === company`):** Sun via **`profiles.subscription_tier`** (normalized to Studio/Agency/…); see `app/project/[id].tsx`.

**Implementation:** `lib/sunPlannerWorkspaceTrial.ts` (`freelancerProductionSunAllowed` / `freelancerProductionWeatherAllowed`) and `app/project/[id].tsx` — **no** `job_id` bypass for workspace; trial start via `touch_sun_planner_trial_start` (workspace + starter).

**Website copy (EN):** Workspace = private-only; sun & weather in production = **14-day trial then locked**. Starter = **full weather**; sun planner = **14-day trial**, full on **Pro/Premium**.

---

## 5. Companies (hiring)

| Area | Summary |
|------|---------|
| Post public jobs, applications | **Company** only, not freelancer |
| Talent pool | Company has access |
| Project workspace from job | Typically `job_id` set → crew, marketplace context; **sun/weather for freelancer** still per **§4** (subscription), not automatically “full” because of the job |

---

## 6. Alerts / push (short)

- Crew added (`project_members`): feed entry + optional push `project_crew_invite`; private project includes lead name in text.
- CEO: feed often intentionally empty for project alerts.

---

## 7. Copy suggestions (aligned web + app)

Use **short notes** under locked elements:

| Situation | Short copy (EN) |
|-----------|-----------------|
| Talent pool locked | Available with **Pro or Premium**. Upgrade in your account on the website. |
| Private projects as starter | Private lead projects from **Pro** or **Workspace**. Choose a plan on the web. |
| Crew Pro features (starter) | **Pro** only (crew by name, external contacts). |
| Public freelancer calendar (starter) | **Pro** only; shoot days appear on the public profile. |
| Sun/weather after trial (workspace) | 14-day trial for sun **and** weather in production has ended — unlock again with an upgrade (e.g. Pro/Premium). No parallel “company job” path in workspace marketing. |
| Sun planner after trial (starter) | Full access with **Pro / Premium**; weather stays full on starter. |

Mirror in DE if needed: „Available from Pro“, „Pro or Workspace plan“, „14-day trial on private projects“.

---

## 8. Website: technical to-dos (when working on the web project)

1. **Same entitlement source** as the app: `user_metadata.freelancer_plan` + `role` + `subscription_tier` (company).  
2. **Mirror UI:** buttons/pages instead of silent disable + hint as in the table.  
3. **Do not** claim different behavior than the app for the same audience.  
4. **Premium = Pro** in app logic for pool — website copy: either “Pro / Premium” or explicit “Premium includes …” if you sell more.

---

## 9. App file index (for developers)

| Topic | File(s) |
|-------|---------|
| Plans | `lib/freelancerPlan.ts`, `lib/sunPlannerWorkspaceTrial.ts` |
| Workspace-only tabs | `app/(tabs)/_layout.tsx` |
| Dashboard quick actions | `app/(tabs)/dashboard.tsx` |
| Private projects list | `app/(tabs)/workspace-projects.tsx` |
| Project: sun, workspace, starter | `app/project/[id].tsx` |
| Production sun/weather | `app/components/project/[projectId]/ProductionTab.tsx` |
| Crew + Pro | `components/project/ProjectCrewTab.tsx` |
| Talent pool | `app/(tabs)/talent-pool.tsx` |
| Availability booking (active jobs only; web↔app same rule) | App: `components/profile/BookFreelancerModal.tsx`, `FreelancerPublicProfileContent.tsx` · Web: `crea-services/app/components/FreelancerPublicCalendar.tsx` |
| Feed alerts | `lib/notificationsFeed.ts` |
| RLS pool (DB) | `supabase/sql/talent_pool_select_policies.sql` |

---

*Last aligned with app logic in `crea-app`; if the web repo diverges, update this file.*
