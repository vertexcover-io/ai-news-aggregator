import { sendingDomains, tenantScope } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type {
  SendingDomainInsert,
  SendingDomainRow,
  SendingDomainStatus,
  TenantContext,
} from "@newsletter/shared";

export type SendingDomainUpsertInput = Omit<SendingDomainInsert, "tenantId" | "id">;

export interface SendingDomainsRepo {
  get(): Promise<SendingDomainRow | null>;
  upsert(input: SendingDomainUpsertInput): Promise<SendingDomainRow>;
  updateStatus(
    status: SendingDomainStatus,
    extra?: {
      providerDomainId?: string | null;
      dnsRecords?: unknown[] | null;
      failureReasons?: string[] | null;
    },
  ): Promise<SendingDomainRow>;
}

export function createSendingDomainsRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
  ctx?: TenantContext,
): SendingDomainsRepo {
  const scope = tenantScope(sendingDomains.tenantId, ctx);
  return {
    async get(): Promise<SendingDomainRow | null> {
      const rows = await db
        .select()
        .from(sendingDomains)
        .where(scope.where())
        .limit(1);
      return rows[0] ?? null;
    },

    async upsert(input: SendingDomainUpsertInput): Promise<SendingDomainRow> {
      const values = { ...input, updatedAt: new Date() };
      const [row] = await db
        .insert(sendingDomains)
        .values(scope.stamp(values))
        .onConflictDoUpdate({
          target: sendingDomains.tenantId,
          set: values,
        })
        .returning();
      return row;
    },

    async updateStatus(
      status: SendingDomainStatus,
      extra?: {
        providerDomainId?: string | null;
        dnsRecords?: unknown[] | null;
        failureReasons?: string[] | null;
      },
    ): Promise<SendingDomainRow> {
      const [row] = await db
        .update(sendingDomains)
        .set({ status, updatedAt: new Date(), ...(extra ?? {}) })
        .where(scope.where())
        .returning();
      return row;
    },
  };
}
