import { Resend } from "resend";
import type {
  SendingDomainDnsRecord,
  SendingDomainStatus,
} from "@newsletter/shared/db";

/**
 * Thin client over the Resend domains API (REQ-084/085). All Resend response
 * shapes are normalized here so routes and repos only ever see
 * {resendDomainId, status, dnsRecords, failureReason}. Requires a FULL-ACCESS
 * Resend key (sending-only keys cannot manage domains).
 */

export interface ResendDomainState {
  resendDomainId: string;
  status: SendingDomainStatus;
  dnsRecords: SendingDomainDnsRecord[];
  failureReason: string | null;
}

export class ResendDomainsError extends Error {
  constructor(operation: "create" | "get" | "verify", message: string) {
    super(`Resend domains ${operation} failed: ${message}`);
    this.name = "ResendDomainsError";
  }
}

interface ResendDomainRecordLike {
  record: string;
  name: string;
  type: string;
  value: string;
  status?: string;
}

interface ResendDomainLike {
  id: string;
  status: string;
  records?: ResendDomainRecordLike[];
}

interface ResendResponseLike<T> {
  data: T | null;
  error: { message: string } | null;
}

/** Structural slice of `new Resend(key).domains` — injectable in tests. */
export interface ResendDomainsApi {
  create(payload: { name: string }): Promise<ResendResponseLike<ResendDomainLike>>;
  get(id: string): Promise<ResendResponseLike<ResendDomainLike>>;
  verify(id: string): Promise<ResendResponseLike<{ id: string }>>;
}

export interface ResendDomainsClient {
  /** Registers the domain with Resend and returns the DNS records to add (REQ-084). */
  register: (domain: string) => Promise<ResendDomainState>;
  /** Triggers a verification re-check and returns the refreshed state (REQ-085). */
  check: (resendDomainId: string) => Promise<ResendDomainState>;
}

export function mapDomainStatus(status: string): SendingDomainStatus {
  if (status === "verified") return "verified";
  if (status === "failed" || status === "partially_failed") return "failed";
  return "pending";
}

function mapDnsRecords(records: ResendDomainRecordLike[]): SendingDomainDnsRecord[] {
  return records.map((r) => ({
    record: r.record,
    name: r.name,
    type: r.type,
    value: r.value,
    ...(r.status === undefined ? {} : { status: r.status }),
  }));
}

function deriveFailureReason(
  status: SendingDomainStatus,
  records: ResendDomainRecordLike[],
): string | null {
  if (status !== "failed") return null;
  const failing = records.filter(
    (r) => r.status === "failed" || r.status === "temporary_failure",
  );
  if (failing.length === 0) return "Domain verification failed";
  return failing
    .map((r) => `${r.record} record (${r.type} ${r.name}): ${r.status ?? "failed"}`)
    .join("; ");
}

export function toDomainState(domain: ResendDomainLike): ResendDomainState {
  const records = domain.records ?? [];
  const status = mapDomainStatus(domain.status);
  return {
    resendDomainId: domain.id,
    status,
    dnsRecords: mapDnsRecords(records),
    failureReason: deriveFailureReason(status, records),
  };
}

function unwrap<T>(
  operation: "create" | "get" | "verify",
  response: ResendResponseLike<T>,
): T {
  if (response.error !== null) {
    throw new ResendDomainsError(operation, response.error.message);
  }
  if (response.data === null) {
    throw new ResendDomainsError(operation, "empty response");
  }
  return response.data;
}

export function createResendDomainsClient(api: ResendDomainsApi): ResendDomainsClient {
  return {
    async register(domain: string): Promise<ResendDomainState> {
      const created = unwrap("create", await api.create({ name: domain }));
      return toDomainState(created);
    },

    async check(resendDomainId: string): Promise<ResendDomainState> {
      // verify() only acknowledges the re-check; the refreshed status and
      // per-record state come from a follow-up get().
      unwrap("verify", await api.verify(resendDomainId));
      const domain = unwrap("get", await api.get(resendDomainId));
      return toDomainState(domain);
    },
  };
}

export function createDefaultResendDomainsClient(apiKey: string): ResendDomainsClient {
  return createResendDomainsClient(new Resend(apiKey).domains);
}
