import type { Resend } from "resend";
import type { DnsRecord, DomainVerificationStatus } from "@newsletter/shared/types";

export interface RegisterDomainResult {
  domainId: string;
  status: DomainVerificationStatus;
  records: DnsRecord[];
}

/**
 * Map Resend's domain status to our internal DomainVerificationStatus.
 * "none" is only used when no domain has been registered — never from Resend.
 */
function mapResendStatus(raw: string): DomainVerificationStatus {
  switch (raw) {
    case "verified":
      return "verified";
    case "failed":
      return "failed";
    case "not_started":
    case "pending":
    case "partially_verified":
    case "partially_failed":
    default:
      return "pending";
  }
}

/**
 * Convert a Resend DomainRecords item to our DnsRecord type.
 */
function toDnsRecord(r: { record: string; name: string; type: string; value: string; ttl: string; status: string; priority?: number }): DnsRecord {
  const rec: DnsRecord = {
    record: r.record,
    name: r.name,
    type: r.type,
    value: r.value,
    ttl: r.ttl,
    status: r.status,
  };
  if (r.priority !== undefined) {
    rec.priority = r.priority;
  }
  return rec;
}

/**
 * Register a domain with Resend and return the domainId + DNS records.
 * The domain starts in "pending" state — DNS records must be added before
 * calling checkDomainStatus to verify.
 */
export async function registerDomain(
  resend: Resend,
  domainName: string,
): Promise<RegisterDomainResult> {
  const { data, error } = await resend.domains.create({ name: domainName });
  if (error !== null) {
    throw new Error(error.message);
  }

  return {
    domainId: data.id,
    status: mapResendStatus(data.status),
    records: data.records.map(toDnsRecord),
  };
}

export interface CheckDomainStatusResult {
  status: DomainVerificationStatus;
  records: DnsRecord[];
  failureReasons?: string[];
}

/**
 * Check the status of a registered domain via Resend.
 * If status is "failed", collects failure reasons from individual DNS records.
 */
export async function checkDomainStatus(
  resend: Resend,
  domainId: string,
): Promise<CheckDomainStatusResult> {
  const { data, error } = await resend.domains.get(domainId);
  if (error !== null) {
    throw new Error(error.message);
  }

  const status = mapResendStatus(data.status);
  const records: DnsRecord[] = data.records.map(toDnsRecord);

  const result: CheckDomainStatusResult = { status, records };

  if (status === "failed") {
    result.failureReasons = data.records
      .filter((r) => r.status === "failed" || r.status === "temporary_failure")
      .map((r) => `${r.record} (${r.name}): ${r.status}`);
  }

  return result;
}
