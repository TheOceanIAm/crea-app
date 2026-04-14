/* eslint-disable */
import * as Router from 'expo-router';

export * from 'expo-router';

declare module 'expo-router' {
  export namespace ExpoRouter {
    export interface __routes<T extends string = string> extends Record<string, unknown> {
      StaticRoutes: `/` | `/(tabs)` | `/(tabs)/availability` | `/(tabs)/ceo-companies` | `/(tabs)/ceo-revenue` | `/(tabs)/ceo-settings` | `/(tabs)/ceo-users` | `/(tabs)/company-applications` | `/(tabs)/company-hub` | `/(tabs)/company-my-jobs` | `/(tabs)/company-post-job` | `/(tabs)/dashboard` | `/(tabs)/invoices` | `/(tabs)/invoices/` | `/(tabs)/invoices/new` | `/(tabs)/jobs` | `/(tabs)/jobs/` | `/(tabs)/messages` | `/(tabs)/profile` | `/(tabs)/profile-preview` | `/_sitemap` | `/availability` | `/ceo-companies` | `/ceo-revenue` | `/ceo-settings` | `/ceo-users` | `/company-applications` | `/company-hub` | `/company-my-jobs` | `/company-post-job` | `/dashboard` | `/invoices` | `/invoices/` | `/invoices/new` | `/jobs` | `/jobs/` | `/login` | `/messages` | `/onboarding` | `/profile` | `/profile-preview` | `/register`;
      DynamicRoutes: `/(tabs)/invoices/${Router.SingleRoutePart<T>}` | `/(tabs)/jobs/${Router.SingleRoutePart<T>}` | `/invoices/${Router.SingleRoutePart<T>}` | `/jobs/${Router.SingleRoutePart<T>}` | `/profile/${Router.SingleRoutePart<T>}` | `/project/${Router.SingleRoutePart<T>}`;
      DynamicRouteTemplate: `/(tabs)/invoices/[id]` | `/(tabs)/jobs/[id]` | `/invoices/[id]` | `/jobs/[id]` | `/profile/[userId]` | `/project/[id]`;
    }
  }
}
