import type { ArchiveListItem } from "./archive.js";
import type { PublicMustReadEntry } from "./must-read.js";

/** Per-tenant flags driving nav/render decisions on the public site. */
export interface TenantFlags {
  /** Whether the Canon / Must Read feature is enabled for this tenant. */
  canon: boolean;
  /** True only for the platform owner (tenant ID 0 / AGENTLOOP). */
  isTenantZero: boolean;
}

/**
 * Public branding surface for a tenant.
 * Derived from the tenants row and served in the home API payload so the
 * frontend never hardcodes brand strings.
 */
export interface TenantBranding {
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  /** Relative path like /api/logo/:slug, or null when no logo is uploaded. */
  logoUrl: string | null;
  flags: TenantFlags;
}

export interface HomePagePayload {
  /** Per-tenant branding — de-hardcodes AGENTLOOP. */
  branding: TenantBranding;
  todaysIssue: ArchiveListItem | null;
  featuredCanon: PublicMustReadEntry | null;
  recentIssues: ArchiveListItem[];
}
