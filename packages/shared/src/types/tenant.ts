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

/** Audited platform-level actions (P6 — impersonation start/stop, REQ-103). */
export type AuditAction = "impersonation_start" | "impersonation_stop";

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

/* ── Branding wire types (P7: REQ-040/041/042/043) ──────────────────────── */

/** Per-tenant feature flags the public site needs for nav derivation (REQ-042). */
export interface TenantBrandingFlags {
  /** Canon/Must-Read feature — `Must Read` nav + Elsewhere column only when on. */
  canon: boolean;
}

/**
 * Public branding payload (`GET /api/branding`) — everything the public site
 * chrome needs to render a tenant's identity with no hardcoded brand
 * (REQ-040). Served for the Host-resolved tenant; falls back to tenant 0 on
 * the app host (local dev / legacy single-tenant).
 */
export interface TenantBranding {
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  /** Versioned logo URL (`/api/branding/logo?v=…`); null when no logo uploaded. */
  logoUrl: string | null;
  flags: TenantBrandingFlags;
  /** AGENTLOOP-only surfaces (`Built` nav, colophon) render only when true (REQ-042). */
  isTenantZero: boolean;
}

/* ── Auth wire types (P3: signup / login / session) ─────────────────────── */

/** The authenticated user as exposed to the web client (no passwordHash). */
export interface SessionUser {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  role: UserRole;
}

/** Tenant summary returned alongside the session (no logo bytes / config). */
export interface SessionTenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
}

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface SignupResponse {
  next: "onboarding";
  user: SessionUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  ok: true;
  user: SessionUser;
}

export interface AuthMeResponse {
  user: SessionUser;
  /** Null for super_admin sessions. */
  tenant: SessionTenant | null;
  /**
   * Present (non-null) only while a super_admin session carries a valid
   * impersonation cookie (P6, REQ-101/102). Optional so pre-P6 clients and
   * cached responses keep parsing.
   */
  impersonation?: { tenant: SessionTenant } | null;
}
