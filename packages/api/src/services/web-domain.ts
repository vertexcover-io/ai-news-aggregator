/**
 * Custom web-domain service (Fix #3, Phase C). Implements the Vercel-style
 * add-domain flow: register a domain (→ DNS record to add), then verify it
 * resolves to our ingress before marking it `verified`. Only a `verified`
 * domain is served (host→tenant resolver) and allowed a cert (Caddy on-demand
 * TLS `ask` endpoint).
 *
 * DNS lookup is injected (`resolveDns`) so tests run without real DNS.
 */
import { resolveCname, resolve4 } from "node:dns/promises";
import type { TenantRow } from "@newsletter/shared/db";
import type {
  CustomDomainDnsRecord,
  CustomDomainWire,
} from "@newsletter/shared/types/tenant";

export interface WebDomainTenantsRepo {
  findById(id: string): Promise<TenantRow | null>;
  updateCustomDomain(
    id: string,
    patch: {
      customDomain: string | null;
      customDomainStatus: "pending" | "verified" | "failed" | null;
      customDomainVerifiedAt: Date | null;
    },
  ): Promise<TenantRow | null>;
}

export interface DnsLookupResult {
  cnames: string[];
  addresses: string[];
}

export interface WebDomainServiceDeps {
  tenantsRepo: WebDomainTenantsRepo;
  /** Resolve a host's CNAME + A records; returns empty arrays on NXDOMAIN. */
  resolveDns: (domain: string) => Promise<DnsLookupResult>;
  /** Stable host tenants CNAME their subdomain at (e.g. ingress.vertexcover.io). */
  ingressHost: string;
  /** Public VPS IP tenants A-record their apex at. */
  ingressIp: string;
  /** Hosts/suffixes a tenant may NOT claim (our own root + app hosts). */
  reservedSuffixes: string[];
}

export class WebDomainError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "WebDomainError";
  }
}

// Hostname only — no scheme/path, RFC-1035 labels, at least one dot.
const DOMAIN_RE =
  /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Apex domains (2 labels, e.g. example.com) need an A record; deeper hosts CNAME. */
export function isApex(domain: string): boolean {
  return domain.split(".").length <= 2;
}

export function dnsRecordFor(
  domain: string,
  ingressHost: string,
  ingressIp: string,
): CustomDomainDnsRecord {
  return isApex(domain)
    ? { type: "A", name: domain, value: ingressIp }
    : { type: "CNAME", name: domain, value: ingressHost };
}

export function webDomainFromTenant(
  tenant: TenantRow,
  ingressHost: string,
  ingressIp: string,
): CustomDomainWire {
  if (tenant.customDomain === null) {
    return { domain: null, status: null, record: null, verifiedAt: null };
  }
  return {
    domain: tenant.customDomain,
    status: tenant.customDomainStatus,
    record: dnsRecordFor(tenant.customDomain, ingressHost, ingressIp),
    verifiedAt: tenant.customDomainVerifiedAt?.toISOString() ?? null,
  };
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, "");
}

/** Production DNS lookup — NXDOMAIN / no-records resolve to empty arrays. */
export async function resolveDnsDefault(domain: string): Promise<DnsLookupResult> {
  const cnames = await resolveCname(domain).catch(() => [] as string[]);
  const addresses = await resolve4(domain).catch(() => [] as string[]);
  return { cnames, addresses };
}

export async function registerWebDomain(
  deps: WebDomainServiceDeps,
  tenantId: string,
  rawDomain: string,
): Promise<CustomDomainWire> {
  const domain = normalizeDomain(rawDomain);
  if (!DOMAIN_RE.test(domain)) {
    throw new WebDomainError("must be a bare domain like news.example.com", 400);
  }
  // Never let a tenant claim our own infrastructure hosts.
  for (const suffix of deps.reservedSuffixes) {
    const s = suffix.toLowerCase();
    if (domain === s || domain.endsWith(`.${s}`)) {
      throw new WebDomainError("that domain is reserved", 400);
    }
  }
  const updated = await deps.tenantsRepo.updateCustomDomain(tenantId, {
    customDomain: domain,
    customDomainStatus: "pending",
    customDomainVerifiedAt: null,
  });
  if (updated === null) throw new WebDomainError("tenant not found", 404);
  return webDomainFromTenant(updated, deps.ingressHost, deps.ingressIp);
}

export async function verifyWebDomain(
  deps: WebDomainServiceDeps,
  tenantId: string,
): Promise<CustomDomainWire> {
  const tenant = await deps.tenantsRepo.findById(tenantId);
  if (tenant === null) throw new WebDomainError("tenant not found", 404);
  if (tenant.customDomain === null) {
    throw new WebDomainError("no custom domain registered", 400);
  }

  const domain = tenant.customDomain;
  const dns = await deps.resolveDns(domain);
  const ingressHost = deps.ingressHost.toLowerCase().replace(/\.$/, "");
  const points = isApex(domain)
    ? dns.addresses.includes(deps.ingressIp)
    : dns.cnames
        .map((c) => c.toLowerCase().replace(/\.$/, ""))
        .includes(ingressHost);

  const updated = await deps.tenantsRepo.updateCustomDomain(tenantId, {
    customDomain: domain,
    customDomainStatus: points ? "verified" : "failed",
    customDomainVerifiedAt: points ? new Date() : null,
  });
  if (updated === null) throw new WebDomainError("tenant not found", 404);
  return webDomainFromTenant(updated, deps.ingressHost, deps.ingressIp);
}
