/**
 * Custom web-domain API client (Fix #3, Phase C) — backs the Settings panel.
 */
import type { CustomDomainWire } from "@newsletter/shared/types/tenant";
import { apiFetchAdmin } from "./client";

export class WebDomainApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "WebDomainApiError";
    this.status = status;
  }
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new WebDomainApiError(body.error ?? fallback, res.status);
}

export async function getWebDomain(): Promise<CustomDomainWire> {
  const res = await apiFetchAdmin("/api/admin/web-domain");
  if (!res.ok) await readError(res, "Failed to load web domain");
  return (await res.json()) as CustomDomainWire;
}

export async function registerWebDomain(
  domain: string,
): Promise<CustomDomainWire> {
  const res = await apiFetchAdmin("/api/admin/web-domain", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) await readError(res, "Failed to add web domain");
  return (await res.json()) as CustomDomainWire;
}

export async function verifyWebDomain(): Promise<CustomDomainWire> {
  const res = await apiFetchAdmin("/api/admin/web-domain/verify", {
    method: "POST",
  });
  if (!res.ok) await readError(res, "Failed to verify web domain");
  return (await res.json()) as CustomDomainWire;
}
