/**
 * Tenancy contracts shared across api / pipeline / web.
 *
 * Wire types only — DB row types (including `passwordHash` and `logoBytes`)
 * come from the Drizzle schema (`tenants.$inferSelect` / `users.$inferSelect`)
 * and never cross the HTTP boundary.
 */

/** Lifecycle of a tenant: created via signup → `pending_setup`; onboarding wizard activation → `active`. */
export type TenantStatus = "pending_setup" | "active";

/** `super_admin` is platform-level (no tenant); `tenant_admin` owns exactly one tenant. */
export type UserRole = "super_admin" | "tenant_admin";

/** Resumable onboarding-wizard progress, persisted per tenant (P11 consumes this). */
export interface OnboardingState {
  /** Step key the tenant last worked on (wizard is resumable). */
  currentStep: string;
  /** Step keys already completed. */
  completedSteps: string[];
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  customDomain: string | null;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  /** MIME type of the stored logo; null when no logo uploaded. Bytes are served via a dedicated endpoint. */
  logoContentType: string | null;
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
  onboardingState: OnboardingState | null;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}

export interface User {
  id: string;
  /** Null for `super_admin` accounts — they belong to the platform, not a tenant. */
  tenantId: string | null;
  email: string;
  name: string;
  role: UserRole;
  /** ISO timestamp. */
  createdAt: string;
  /** ISO timestamp. */
  updatedAt: string;
}
