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

/**
 * In-progress wizard field values (P11, REQ-030/032). Everything stays in
 * this jsonb bag until activation applies it to the real stores (tenant
 * profile + user_settings). Sources and the logo are the exception — they
 * are written live to their tables as the tenant adds them.
 */
export interface OnboardingData {
  name?: string;
  slug?: string;
  headline?: string;
  topicStrip?: string;
  subtagline?: string;
  /** Newsletter description used for prompt generation + source discovery. */
  blurb?: string;
  rankingPrompt?: string;
  shortlistPrompt?: string;
  /** HH:mm — daily pipeline start. */
  pipelineTime?: string;
  /** HH:mm — daily digest send. */
  emailTime?: string;
  /** IANA timezone for the schedule. */
  timezone?: string;
}

/** Resumable onboarding-wizard progress, persisted per tenant (P11 consumes this). */
export interface OnboardingState {
  /** Step key the tenant last worked on (wizard is resumable). */
  currentStep: string;
  /** Step keys already completed. */
  completedSteps: string[];
  /** Partial wizard field values (REQ-030 — resume restores these). */
  data?: OnboardingData;
}

/* ── Onboarding wire types (P11: REQ-030–038, REQ-051) ──────────────────── */

/** Steps that must be complete before activation (REQ-025/035/038). */
export const ONBOARDING_REQUIRED_STEPS = [
  "name",
  "slug",
  "headline",
  "prompts",
  "sources",
  "schedule",
] as const;

export type OnboardingRequiredStep = (typeof ONBOARDING_REQUIRED_STEPS)[number];

/** `GET /api/onboarding` — everything the wizard needs to resume. */
export interface OnboardingStateResponse {
  status: TenantStatus;
  state: OnboardingState | null;
  /** True when a logo is already stored (uploads are live, REQ-029). */
  hasLogo: boolean;
  /** Live count of the tenant's source rows (activation needs ≥1). */
  sourcesCount: number;
}

/** `GET /api/onboarding/slug-available` (REQ-033, EDGE-001/003). */
export type SlugAvailability = "available" | "invalid" | "reserved" | "taken";

export interface SlugAvailableResponse {
  slug: string;
  status: SlugAvailability;
}

/** `POST /api/onboarding/generate-prompts` (REQ-036) — both editable. */
export interface GeneratePromptsResponse {
  rankingPrompt: string;
  shortlistPrompt: string;
}

/**
 * One discovered source suggestion (REQ-051/037). `type`+`value` feed the
 * existing manual-add path (`POST /api/sources`) when clicked — discovery
 * itself adds NOTHING.
 */
export interface SourceCandidate {
  /** Manual-add source type (see MANUAL_SOURCE_TYPES). */
  type: string;
  /** The manual-add input value (URL, subreddit, @handle, query). */
  value: string;
  /** Human label for the pill. */
  label: string;
  /** Display group, e.g. "Reddit", "RSS / Blogs", "X / Handles". */
  group: string;
}

export interface DiscoverSourcesResponse {
  candidates: SourceCandidate[];
}

/** `POST /api/onboarding/activate` failure body (REQ-028/038, EDGE-001). */
export interface ActivateBlockedResponse {
  error: "incomplete" | "slug_taken";
  missing: OnboardingRequiredStep[];
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

/**
 * Admin branding settings (`GET/PUT /api/settings/branding`, FIX #1) — the
 * onboarding-captured brand fields surfaced for view + edit in Admin Settings.
 * Distinct from the public `TenantBranding`: no feature flags / tenant-zero
 * marker, and the logo previews from the session-scoped admin endpoint.
 */
export interface BrandingSettings {
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  /** Versioned admin preview URL (`/api/settings/branding/logo?v=…`); null when no logo. */
  logoUrl: string | null;
  hasLogo: boolean;
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

/* ── Sending-domain wire types (P14: REQ-084/085, REQ-053) ──────────────── */

/**
 * Tenant-facing domain status, collapsed from Resend's six-state
 * `DomainStatus`: `verified` ⇐ verified; `failed` ⇐ failed/partially_failed
 * (reasons surfaced per record, REQ-085); everything else (pending,
 * not_started, partially_verified) ⇐ `pending`. Broadcasts are gated on
 * `verified` (REQ-053/EDGE-006).
 */
export type SendingDomainStatus = "pending" | "verified" | "failed";

/** One DNS record the tenant must create, as returned by Resend (REQ-084). */
export interface SendingDomainRecord {
  /** Resend record group: SPF | DKIM | Receiving | Tracking | TrackingCAA. */
  record: string;
  /** DNS record type: TXT | MX | CNAME | CAA. */
  type: string;
  name: string;
  value: string;
  ttl?: string;
  priority?: number;
  /** Per-record verification state (pending | verified | failed | …). */
  status: string;
}

/** Sending-domain panel payload (GET/POST /api/settings/domain[/verify]). */
export interface SendingDomainWire {
  domain: string;
  status: SendingDomainStatus;
  records: SendingDomainRecord[];
  /** Human-readable failure reasons; present only when status = "failed". */
  reasons?: string[];
}

/**
 * Notification settings panel payload (GET/PUT /api/settings/notifications,
 * P16 REQ-092). The Slack webhook is write-only: clients send the raw URL on
 * PUT, but only ever read back `slackWebhookSet` — the ciphertext (let alone
 * the plaintext) never crosses the wire to the browser.
 */
export interface TenantNotificationSettingsWire {
  notifyEmail: string | null;
  slackWebhookSet: boolean;
  notifyReviewReady: boolean;
  notifyErrors: boolean;
}

/** Optional feature flags payload (GET/PUT /api/settings/features, REQ-093). */
export interface TenantFeatureFlagsWire {
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
}
