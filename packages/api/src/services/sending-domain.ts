/**
 * Per-tenant Resend sending-domain verification (P14, REQ-084/085).
 *
 * A tenant registers a domain (`resend.domains.create`) and gets back the DNS
 * records to install; "verify" triggers Resend's check (`domains.verify`) and
 * re-reads current state (`domains.get`). `{domainId, status, records}` are
 * persisted on the tenant row; the pipeline broadcast gate (REQ-053) reads
 * `sendingDomainStatus` and refuses the subscriber broadcast until it is
 * `verified`. Transactional mail (confirm/reset/notify) never touches this —
 * it always goes out via the shared platform sender (REQ-067/EDGE-005).
 *
 * OPS — Resend key scope + domain quota (probe findings, library-probe.md):
 * - The Domains API requires a FULL-ACCESS Resend key (a send-only key gets
 *   `401 restricted_api_key`). Delivery may keep using a send-only key.
 *   `RESEND_FULL_ACCESS_API_KEY` overrides `RESEND_API_KEY` for this client.
 * - One verified domain per tenant means the Resend PLAN domain quota must be
 *   ≥ the number of active tenants (current plan caps at 1 → `403 "Your plan
 *   includes 1 domain"`). Decision required before scale — see design Risks.
 */
import { Resend } from "resend";
import type {
  SendingDomainRecord,
  SendingDomainStatus,
  SendingDomainWire,
} from "@newsletter/shared/types/tenant";
import type {
  SendingDomainPatch,
  TenantRow,
  TenantsRepo,
} from "@api/repositories/tenants.js";

/** Resend domain payload slice consumed here (create/get share this shape). */
export interface ResendDomainShape {
  id: string;
  name: string;
  status: string;
  records: {
    record: string;
    type: string;
    name: string;
    value: string;
    ttl?: string;
    priority?: number;
    status: string;
  }[];
}

export interface ResendDomainsError {
  name: string;
  message: string;
}

/**
 * Structural slice of `Resend.domains` — injected so tests (and the e2e
 * harness via RESEND_BASE_URL) never hit the live API.
 */
export interface ResendDomainsClient {
  create(payload: {
    name: string;
  }): Promise<{ data: ResendDomainShape | null; error: ResendDomainsError | null }>;
  get(
    id: string,
  ): Promise<{ data: ResendDomainShape | null; error: ResendDomainsError | null }>;
  verify(id: string): Promise<{ error: ResendDomainsError | null }>;
}

export class SendingDomainError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 502 | 503,
  ) {
    super(message);
    this.name = "SendingDomainError";
  }
}

export type SendingDomainTenantsRepo = Pick<
  TenantsRepo,
  "findById" | "updateSendingDomain"
>;

export interface SendingDomainDeps {
  tenantsRepo: SendingDomainTenantsRepo;
  domainsClient: ResendDomainsClient;
}

/**
 * Collapse Resend's six-state `DomainStatus` to the tenant-facing tri-state:
 * only full `verified` opens the broadcast gate; failed/partially_failed
 * surface reasons; everything in-flight stays `pending`.
 */
export function collapseDomainStatus(status: string): SendingDomainStatus {
  if (status === "verified") return "verified";
  if (status === "failed" || status === "partially_failed") return "failed";
  return "pending";
}

function toRecords(domain: ResendDomainShape): SendingDomainRecord[] {
  return domain.records.map((r) => ({
    record: r.record,
    type: r.type,
    name: r.name,
    value: r.value,
    ...(r.ttl !== undefined ? { ttl: r.ttl } : {}),
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    status: r.status,
  }));
}

function failureReasons(records: SendingDomainRecord[]): string[] {
  return records
    .filter((r) => r.status === "failed" || r.status === "temporary_failure")
    .map((r) => `${r.record} ${r.type} record "${r.name}" is ${r.status.replace("_", " ")}`);
}

function toWire(
  domainName: string,
  status: SendingDomainStatus,
  records: SendingDomainRecord[],
): SendingDomainWire {
  const reasons = status === "failed" ? failureReasons(records) : [];
  return {
    domain: domainName,
    status,
    records,
    ...(reasons.length > 0 ? { reasons } : {}),
  };
}

/** Maps a stored tenant row to the panel payload; null when never registered. */
export function sendingDomainFromTenant(row: TenantRow): SendingDomainWire | null {
  if (row.sendingDomainName === null || row.sendingDomainStatus === null) {
    return null;
  }
  return toWire(
    row.sendingDomainName,
    row.sendingDomainStatus,
    row.sendingDomainRecords ?? [],
  );
}

/** REQ-084: register the domain with Resend and persist DNS records. */
export async function registerSendingDomain(
  deps: SendingDomainDeps,
  tenantId: string,
  domainName: string,
): Promise<SendingDomainWire> {
  const result = await deps.domainsClient.create({ name: domainName });
  if (result.error !== null || result.data === null) {
    throw new SendingDomainError(
      `Resend rejected the domain: ${result.error?.message ?? "empty response"}`,
      502,
    );
  }
  const status = collapseDomainStatus(result.data.status);
  const records = toRecords(result.data);
  await persist(deps, tenantId, {
    sendingDomainName: result.data.name,
    sendingDomainId: result.data.id,
    sendingDomainStatus: status,
    sendingDomainRecords: records,
  });
  return toWire(result.data.name, status, records);
}

/** REQ-085: trigger Resend verification and persist the refreshed status. */
export async function verifySendingDomain(
  deps: SendingDomainDeps,
  tenantId: string,
): Promise<SendingDomainWire> {
  const tenant = await deps.tenantsRepo.findById(tenantId);
  if (tenant === null) throw new SendingDomainError("tenant not found", 404);
  if (tenant.sendingDomainId === null || tenant.sendingDomainName === null) {
    throw new SendingDomainError("no sending domain registered", 404);
  }

  // Best-effort trigger: Resend re-checks DNS on verify; a verify error (e.g.
  // a check already in flight) must not mask the current state read below.
  await deps.domainsClient.verify(tenant.sendingDomainId);

  const result = await deps.domainsClient.get(tenant.sendingDomainId);
  if (result.error !== null || result.data === null) {
    throw new SendingDomainError(
      `Resend domain lookup failed: ${result.error?.message ?? "empty response"}`,
      502,
    );
  }
  const status = collapseDomainStatus(result.data.status);
  const records = toRecords(result.data);
  await persist(deps, tenantId, {
    sendingDomainName: tenant.sendingDomainName,
    sendingDomainId: tenant.sendingDomainId,
    sendingDomainStatus: status,
    sendingDomainRecords: records,
  });
  return toWire(tenant.sendingDomainName, status, records);
}

async function persist(
  deps: SendingDomainDeps,
  tenantId: string,
  patch: SendingDomainPatch,
): Promise<void> {
  const updated = await deps.tenantsRepo.updateSendingDomain(tenantId, patch);
  if (updated === null) throw new SendingDomainError("tenant not found", 404);
}

/**
 * Production adapter over the Resend SDK. Lazy: the key is read per call so
 * a missing key fails the request (503), never process startup. Honors
 * RESEND_BASE_URL (SDK built-in) — the e2e harness points it at a fake.
 */
export function createDefaultResendDomainsClient(): ResendDomainsClient {
  const domains = (): Resend["domains"] => {
    const apiKey =
      process.env.RESEND_FULL_ACCESS_API_KEY ?? process.env.RESEND_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      throw new SendingDomainError(
        "sending-domain API not configured: set RESEND_FULL_ACCESS_API_KEY (or RESEND_API_KEY)",
        503,
      );
    }
    return new Resend(apiKey).domains;
  };
  return {
    async create(payload) {
      const res = await domains().create({ name: payload.name });
      return { data: res.data, error: res.error };
    },
    async get(id) {
      const res = await domains().get(id);
      return { data: res.data, error: res.error };
    },
    async verify(id) {
      const res = await domains().verify(id);
      return { error: res.error };
    },
  };
}
