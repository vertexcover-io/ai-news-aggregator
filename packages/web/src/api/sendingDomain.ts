/**
 * Sending-domain API client (P14, REQ-084/085) — backs the Settings panel.
 */
import type { SendingDomainWire } from "@newsletter/shared/types/tenant";
import { apiFetchAdmin } from "./client";

export class SendingDomainApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SendingDomainApiError";
    this.status = status;
  }
}

async function readError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new SendingDomainApiError(body.error ?? fallback, res.status);
}

export async function getSendingDomain(): Promise<SendingDomainWire | null> {
  const res = await apiFetchAdmin("/api/settings/domain");
  if (!res.ok) await readError(res, "Failed to load sending domain");
  const body = (await res.json()) as { domain: SendingDomainWire | null };
  return body.domain;
}

export async function addSendingDomain(
  domain: string,
): Promise<SendingDomainWire> {
  const res = await apiFetchAdmin("/api/settings/domain", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) await readError(res, "Failed to add sending domain");
  const body = (await res.json()) as { domain: SendingDomainWire };
  return body.domain;
}

export async function verifySendingDomain(): Promise<SendingDomainWire> {
  const res = await apiFetchAdmin("/api/settings/domain/verify", {
    method: "POST",
  });
  if (!res.ok) await readError(res, "Failed to verify sending domain");
  const body = (await res.json()) as { domain: SendingDomainWire };
  return body.domain;
}
