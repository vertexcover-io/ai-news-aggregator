import type { SendingDomainStatus } from "@newsletter/shared";
import { apiFetch } from "./client";

export interface SendingDomain {
  domain: string | null;
  status: SendingDomainStatus;
  dnsRecords?: unknown[] | null;
  failureReasons?: string[] | null;
  verified: boolean;
  updatedAt?: string;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return body.message ?? body.error ?? fallback;
}

export async function getDomain(): Promise<SendingDomain> {
  const res = await apiFetch("/api/sending-domains");
  if (!res.ok) throw new Error(await errorMessage(res, "failed to load domain"));
  return (await res.json()) as SendingDomain;
}

export async function registerDomain(domain: string): Promise<SendingDomain> {
  const res = await apiFetch("/api/sending-domains", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "failed to register domain"));
  return (await res.json()) as SendingDomain;
}

export async function verifyDomain(): Promise<SendingDomain> {
  const res = await apiFetch("/api/sending-domains/verify", { method: "POST" });
  if (!res.ok) throw new Error(await errorMessage(res, "verification failed"));
  return (await res.json()) as SendingDomain;
}
