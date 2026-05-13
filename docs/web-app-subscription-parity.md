# Web ↔ App: Abo-Logik & Feature-Parität (1:1 Referenz)

Diese Datei ist die **Single Source of Truth** für Marketing, Website und App-Kommunikation.  
**CEO-Rolle:** absichtlich nicht Endnutzer-relevant (Admin); nicht in Pricing/Feature-Matrizen aufnehmen.

---

## 1. Datenquellen (müssen Web & App identisch sein)

| Feld | Wo | Nutzung |
|------|-----|---------|
| `profiles.role` | DB | `freelancer`, `company`, `ceo`, … |
| `auth.users.user_metadata.freelancer_plan` | JWT / Auth | `workspace` \| `starter` \| `pro` \| `premium` (Default **`starter`** wenn fehlt/unbekannt) |
| `profiles.subscription_tier` | DB | Company-Tiers (siehe Sun Planner Normalisierung in App) |

**App-Helfer:** `lib/freelancerPlan.ts` (`resolveFreelancerPlanFromUser`, `isFreelancerWorkspaceOnlyPlan`, `isFreelancerStarterPlan`, `isFreelancerTalentPoolPlan`, `canFreelancerCreatePrivateProjects`).

---

## 2. Freelancer-Pläne — Matrix

| Plan | Private Projekte anlegen (Lead) | Talent Pool | Tabs „Jobs / Messages / Alerts“ | Income/Stats auf Dashboard | Crew Pro-Features im Projekt | Public Freelancer Calendar (Overview) |
|------|----------------------------------|-------------|----------------------------------|----------------------------|------------------------------|--------------------------------------|
| **Workspace** | Ja | Nein | **Ausgeblendet** (nur Home + Profil + ggf. versteckte Routes) | Nein | Nur **manueller** Crew (ADD CREW), **kein** Namensuche / kein externes Crew wie Pro-Pfad | — (Projekt ggf. eingeschränkt) |
| **Starter** | **Nein** | Nein | Ja | Ja | Gesperrt + Hinweis **Pro** | Gesperrt + Hinweis **Pro** |
| **Pro** | Ja | Ja | Ja | Ja | Namensuche + externe Crew | Ja |
| **Premium** | Ja | Ja (wie Pro) | Ja | Ja | Wie Pro | Wie Pro |

**Wichtig:** In der App sind **Pro** und **Premium** für Talent Pool **gleich** (`isFreelancerTalentPoolPlan`). Premium nur über **Marketing** differenzieren, nicht über andere Gates — oder später eigene Funktion einbauen.

---

## 3. Private Projekte — Definition & Regel

- **Lead-owned private workspace:** Zeile `projects` mit `company_id = Lead`, typischerweise **`job_id` leer** (nicht aus Firmen-Job-Feed).
- **Starter:** **`canFreelancerCreatePrivateProjects`** = falsch → keine neuen privaten Lead-Projekte (Liste/Erstellung gesperrt; Hinweis **Pro oder Workspace**).
- **Workspace / Pro / Premium:** anlegen erlaubt.

**App-Orientierung:** `canFreelancerCreatePrivateProjects`, `app/(tabs)/workspace-projects.tsx`, `app/(tabs)/dashboard.tsx`.

**Öffentliches Profil — Availability-Buchung (Company → Freelancer):** Hier wird **kein** privates Projekt angelegt. Es ist nur die Auswahl eines **bestehenden, aktiven Firmen-Jobs** (`jobs.status = 'active'`) möglich — **App** (`BookFreelancerModal`) und **Web** (`crea-services` → `FreelancerPublicCalendar` BookingModal) sind dabei abgestimmt. Die App verschickt strukturierte Booking-DMs (`sendAvailabilityProjectInvite`); das Web schickt Klartext — die Datenbank löst beim Accept den Job zu (Deep-Link bzw. `Project:`-Zeile).

---

## 4. Sun Planner & Weather (Production)

**Freelancer — Produktregeln (Marketing / Pricing):**

| Plan | Weather (Production) | Sun Planner (Production) |
|------|------------------------|---------------------------|
| **Workspace** | 14 Tage Test, danach gesperrt — Workspace nur für **private Organisation**, kein Talent Pool / Jobs / Marktplatz | 14 Tage Test, danach gesperrt — gleiches Fenster wie Weather |
| **Starter** | **Vollzugriff** | **14-Tage-Test**; dauerhaft voll mit **Pro / Premium** |
| **Pro / Premium** | Vollzugriff | Vollzugriff |

**Firma (`role === company`):** Sun über **`profiles.subscription_tier`** (normalisiert zu Studio/Agency/…); siehe `app/project/[id].tsx`.

**Technik:** Umsetzung in `lib/sunPlannerWorkspaceTrial.ts` (Funktionen `freelancerProductionSunAllowed` / `freelancerProductionWeatherAllowed`) und `app/project/[id].tsx` — **kein** `job_id`-Bypass für Workspace; Trial-Start per `touch_sun_planner_trial_start` (Workspace + Starter).

**Kommunikation Website (EN):** Workspace = private-only; Sun & Weather in Production = **14-day trial then locked**. Starter = **full Weather**; Sun Planner = **14-day trial**, full on **Pro/Premium**.

---

## 5. Firmen (Hiring)

| Bereich | Kurz |
|---------|------|
| Öffentliche Jobs posten, Bewerbungen | Nur **Company**, nicht Freelancer |
| Talent Pool | Company hat Zugriff |
| Projekt-Workspace aus Job | Typisch `job_id` gesetzt → Crew, Marktplatz-Kontext; **Sun/Weather für Freelancer** weiter nach **§4** (Abo), nicht automatisch „voll“ durch den Job |

---

## 6. Alerts / Push (Kurz)

- Crew hinzugefügt (`project_members`): Alert-Eintrag + optional Push `project_crew_invite`; privates Projekt mit Namen des Leads im Text.
- CEO: Feed oft absichtlich leer für Projekt-Alerts.

---

## 7. Copy-Vorschlag (einheitlich Web + App)

Nutze **kurze Notizen** unter gesperrten Elementen:

| Situation | Kurztext (DE) |
|-----------|----------------|
| Talent Pool gesperrt | Nur mit **Pro oder Premium**. Upgrade unter Account auf der Website. |
| Private Projekte als Starter | Private Lead-Projekte ab **Pro** oder **Workspace**. Im Web unter Abo wählen. |
| Crew Pro-Features (Starter) | Nur mit **Pro** (Crew per Namen, externe Kontakte). |
| Public Freelancer Calendar (Starter) | Nur mit **Pro**; Shoot-Tage erscheinen im öffentlichen Profil. |
| Sun/Weather nach Trial (Workspace) | 14-Tage-Test für Sun **und** Weather in Production beendet — erneut nutzbar mit Upgrade (z. B. Pro/Premium). Kein paralleler „Firmen-Job“-Pfad im Workspace-Marketing. |
| Sun Planner nach Trial (Starter) | Dauerhaft voll mit **Pro / Premium**; Weather bleibt bei Starter voll. |

EN spiegeln: „Available from Pro“, „Pro or Workspace plan“, „14-day trial on private projects“.

---

## 8. Website: technische To-dos (wenn Web-Projekt offen)

1. **Gleiche Entitlement-Quelle** wie die App: `user_metadata.freelancer_plan` + `role` + `subscription_tier` (Company).  
2. **UI spiegeln:** Buttons/Seiten statt deaktivieren + Hinweis wie in Tabelle.  
3. **Kein** anderes Verhalten als die App für dieselbe Zielgruppe behaupten.  
4. **Premium = Pro** in der App-Logik für Pool — Website-Text: entweder „Pro / Premium“ oder explizit „Premium inkl. …“ wenn ihr mehr verkauft.

---

## 9. App-Datei-Index (für Entwickler)

| Thema | Datei(en) |
|------|-----------|
| Pläne | `lib/freelancerPlan.ts`, `lib/sunPlannerWorkspaceTrial.ts` |
| Tabs Workspace-only | `app/(tabs)/_layout.tsx` |
| Dashboard Quick Actions | `app/(tabs)/dashboard.tsx` |
| Private Projekte Liste | `app/(tabs)/workspace-projects.tsx` |
| Projekt: Sun, Workspace, Starter | `app/project/[id].tsx` |
| Production Sun/Weather | `app/components/project/[projectId]/ProductionTab.tsx` |
| Crew + Pro | `components/project/ProjectCrewTab.tsx` |
| Talent Pool | `app/(tabs)/talent-pool.tsx` |
| Availability-Buchung (nur aktive Jobs; Web↔App gleiche Regel) | App: `components/profile/BookFreelancerModal.tsx`, `FreelancerPublicProfileContent.tsx` · Web: `crea-services/app/components/FreelancerPublicCalendar.tsx` |
| Feed Alerts | `lib/notificationsFeed.ts` |
| RLS Pool (DB) | `supabase/sql/talent_pool_select_policies.sql` |

---

*Zuletzt an die App-Logik in `crea-app` angeglichen; bei Abweichungen im Web-Repo diese Datei aktualisieren.*
