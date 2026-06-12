import { eq } from "drizzle-orm";
import { sendingDomains } from "@newsletter/shared/db";
import type { AppDb, SendingDomainStatus } from "@newsletter/shared/db";

export interface PipelineSendingDomainRow {
  domain: string;
  status: SendingDomainStatus;
}

export interface PipelineSendingDomainsRepo {
  get(): Promise<PipelineSendingDomainRow | null>;
}

export function createPipelineSendingDomainsRepo(
  db: Pick<AppDb, "select">,
  tenantId: string,
): PipelineSendingDomainsRepo {
  return {
    async get(): Promise<PipelineSendingDomainRow | null> {
      const rows = await db
        .select({
          domain: sendingDomains.domain,
          status: sendingDomains.status,
        })
        .from(sendingDomains)
        .where(eq(sendingDomains.tenantId, tenantId))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
