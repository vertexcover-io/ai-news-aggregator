import { eq } from "drizzle-orm";
import { sendingDomains } from "@newsletter/shared/db";
import type {
  AppDb,
  SendingDomainDnsRecord,
  SendingDomainStatus,
} from "@newsletter/shared/db";

export interface SendingDomainRecord {
  domain: string;
  resendDomainId: string | null;
  status: SendingDomainStatus;
  dnsRecords: SendingDomainDnsRecord[] | null;
  failureReason: string | null;
  lastCheckedAt: Date | null;
  updatedAt: Date;
}

export interface SendingDomainUpsertInput {
  domain: string;
  resendDomainId: string;
  status: SendingDomainStatus;
  dnsRecords: SendingDomainDnsRecord[] | null;
  failureReason: string | null;
}

export interface SendingDomainStatusUpdate {
  status: SendingDomainStatus;
  dnsRecords: SendingDomainDnsRecord[] | null;
  failureReason: string | null;
  lastCheckedAt: Date;
}

export interface SendingDomainsRepo {
  get(): Promise<SendingDomainRecord | null>;
  /** One domain per tenant (tenant_id UNIQUE) — registering again replaces the row. */
  upsert(input: SendingDomainUpsertInput): Promise<SendingDomainRecord>;
  updateStatus(input: SendingDomainStatusUpdate): Promise<SendingDomainRecord | null>;
}

const RECORD_COLUMNS = {
  domain: sendingDomains.domain,
  resendDomainId: sendingDomains.resendDomainId,
  status: sendingDomains.status,
  dnsRecords: sendingDomains.dnsRecords,
  failureReason: sendingDomains.failureReason,
  lastCheckedAt: sendingDomains.lastCheckedAt,
  updatedAt: sendingDomains.updatedAt,
} as const;

export function createSendingDomainsRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
  tenantId: string,
): SendingDomainsRepo {
  return {
    async get(): Promise<SendingDomainRecord | null> {
      const rows = await db
        .select(RECORD_COLUMNS)
        .from(sendingDomains)
        .where(eq(sendingDomains.tenantId, tenantId))
        .limit(1);
      return rows[0] ?? null;
    },

    async upsert(input: SendingDomainUpsertInput): Promise<SendingDomainRecord> {
      const now = new Date();
      const rows = await db
        .insert(sendingDomains)
        .values({ ...input, tenantId, lastCheckedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: sendingDomains.tenantId,
          set: { ...input, lastCheckedAt: now, updatedAt: now },
        })
        .returning(RECORD_COLUMNS);
      return rows[0];
    },

    async updateStatus(
      input: SendingDomainStatusUpdate,
    ): Promise<SendingDomainRecord | null> {
      const rows = await db
        .update(sendingDomains)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(sendingDomains.tenantId, tenantId))
        .returning(RECORD_COLUMNS);
      return rows[0] ?? null;
    },
  };
}
