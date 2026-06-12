import type { UserSettings } from "@newsletter/shared";
import { apiFetchAdmin } from "../../api/client";
import { SettingsApiError } from "../../api/settings";
import type { SettingsSubmitInput } from "../settingsSchema";

/** GET/PUT /api/settings shape after Phase 12: shortlist size never leaves
 * the API (REQ-094); feature toggles + notification channels ride along. */
export type TenantSettings = Omit<UserSettings, "shortlistSize"> & {
  canonEnabled: boolean;
  deliverabilityEnabled: boolean;
  evalEnabled: boolean;
  notificationEmail: string | null;
  hasSlackWebhook: boolean;
};

export interface TenantSettingsSubmit
  extends Omit<SettingsSubmitInput, "shortlistSize"> {
  canonEnabled?: boolean;
  deliverabilityEnabled?: boolean;
  evalEnabled?: boolean;
  notificationEmail?: string | null;
  slackWebhookUrl?: string | null;
}

interface ApiErrorBody {
  error?: string;
  failures?: { handle: string; reason: string }[];
  fields?: string[];
}

export async function getTenantSettings(): Promise<TenantSettings | null> {
  const res = await apiFetchAdmin("/api/settings");
  if (!res.ok) throw new Error("Failed to fetch settings");
  return (await res.json()) as TenantSettings | null;
}

export async function putTenantSettings(
  input: TenantSettingsSubmit,
): Promise<TenantSettings> {
  const res = await apiFetchAdmin("/api/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new SettingsApiError(
      body.error ?? "Failed to save settings",
      res.status,
      body.failures ?? [],
      body.fields ?? [],
    );
  }
  return (await res.json()) as TenantSettings;
}

// ── Branding (PUT /api/admin/branding, REQ-039) ─────────────────────────────

export interface BrandingUpdate {
  name?: string;
  headline?: string;
  topicStrip?: string;
  subtagline?: string | null;
}

export interface BrandingResult {
  name: string;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoVersion: number;
}

export async function putBranding(
  input: BrandingUpdate,
): Promise<BrandingResult> {
  const res = await apiFetchAdmin("/api/admin/branding", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to save branding");
  return (await res.json()) as BrandingResult;
}

export async function uploadLogo(file: File): Promise<{ logoVersion: number }> {
  const form = new FormData();
  form.append("logo", file);
  // Plain fetch wrapper would force a JSON content-type; multipart needs the
  // browser-set boundary, so call fetch with credentials directly here.
  const res = await fetch("/api/admin/branding/logo", {
    method: "PUT",
    credentials: "include",
    body: form,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    throw new Error(body.reason ? `Invalid logo: ${body.reason}` : "Logo upload failed");
  }
  return (await res.json()) as { logoVersion: number };
}

// ── Sending domain (REQ-084/085) ─────────────────────────────────────────────

export interface SendingDomainDnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  status?: string;
}

export interface SendingDomainState {
  domain: string;
  status: "pending" | "verified" | "failed";
  dnsRecords: SendingDomainDnsRecord[];
  failureReason: string | null;
  lastCheckedAt: string | null;
  updatedAt: string;
}

export async function getSendingDomain(): Promise<SendingDomainState | null> {
  const res = await apiFetchAdmin("/api/admin/sending-domain");
  if (!res.ok) throw new Error("Failed to fetch sending domain");
  const body = (await res.json()) as { sendingDomain: SendingDomainState | null };
  return body.sendingDomain;
}

export async function registerSendingDomain(
  domain: string,
): Promise<SendingDomainState> {
  const res = await apiFetchAdmin("/api/admin/sending-domain", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to register domain");
  }
  const body = (await res.json()) as { sendingDomain: SendingDomainState };
  return body.sendingDomain;
}

export async function verifySendingDomain(): Promise<SendingDomainState> {
  const res = await apiFetchAdmin("/api/admin/sending-domain/verify", {
    method: "POST",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to verify domain");
  }
  const body = (await res.json()) as { sendingDomain: SendingDomainState };
  return body.sendingDomain;
}

// ── Twitter OAuth (REQ-080/081) ──────────────────────────────────────────────

export interface TwitterOAuthStatus {
  clientConfigured: boolean;
  connected: boolean;
  connectedAs: string | null;
  expiresAt: string | null;
  hasRefreshToken: boolean;
}

const TWITTER_OAUTH_BASE = "/api/admin/social-credentials/twitter/oauth";

export async function fetchTwitterOAuthStatus(): Promise<TwitterOAuthStatus> {
  const res = await apiFetchAdmin(`${TWITTER_OAUTH_BASE}/status`);
  if (!res.ok) throw new Error("Failed to fetch Twitter connection status");
  return (await res.json()) as TwitterOAuthStatus;
}

export async function startTwitterOAuth(): Promise<{ authorizeUrl: string }> {
  const res = await apiFetchAdmin(`${TWITTER_OAUTH_BASE}/start`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to start Twitter OAuth");
  }
  return (await res.json()) as { authorizeUrl: string };
}

export async function disconnectTwitter(): Promise<void> {
  const res = await apiFetchAdmin(TWITTER_OAUTH_BASE, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to disconnect Twitter");
}
