import type { EncryptedBlob } from "@shared/services/credential-cipher.js";

/** Tenant lifecycle status. */
export type TenantStatus = "pending_setup" | "active";

/** Per-tenant notification configuration: email + encrypted Slack incoming webhook. */
export interface TenantNotificationConfig {
  notifyEmail: string | null;
  slackWebhook: EncryptedBlob | null;
}

/** Per-tenant feature flags — all independent, all default off. */
export interface TenantFeatureFlags {
  canon: boolean;
  deliverability: boolean;
  eval: boolean;
}

/** Domain verification status for per-tenant Resend sending domains. */
export type DomainVerificationStatus = "none" | "pending" | "verified" | "failed";

/** User role within the system. */
export type UserRole = "super_admin" | "tenant_admin" | "public";

/** A single DNS record returned by Resend during domain registration. */
export interface DnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  ttl: string;
  status: string;
  priority?: number;
}

/**
 * Per-tenant onboarding progress.
 * Keys correspond to wizard steps; values are step-completion booleans.
 */
export interface OnboardingState {
  name?: boolean;
  slug?: boolean;
  branding?: boolean;
  prompts?: boolean;
  sources?: boolean;
  schedule?: boolean;
  social?: boolean;
  email?: boolean;
}

/** Represents a tenant (customer account) in the multi-tenant system. */
export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  customDomain: string | null;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoBytes: Uint8Array | null;
  logoContentType: string | null;
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
  notifyEmail: string | null;
  slackWebhook: EncryptedBlob | null;
  onboardingState: OnboardingState | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Represents a user in the multi-tenant system. */
export interface User {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}
