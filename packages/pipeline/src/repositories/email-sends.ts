import { and, eq } from "drizzle-orm";
import { emailSends } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { EmailSendInsert, EmailSendSelect } from "@newsletter/shared";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface PipelineEmailSendsRepo {
  create(insert: EmailSendInsert): Promise<EmailSendSelect>;
  findSentSubscriberIds(runArchiveId: string): Promise<Set<string>>;
}

export function createPipelineEmailSendsRepo(
  db: Pick<AppDb, "select" | "insert">,
  ctx: TenantContext,
): PipelineEmailSendsRepo {
  return {
    async create(insert: EmailSendInsert): Promise<EmailSendSelect> {
      const [row] = await db.insert(emailSends).values({ ...insert, tenantId: ctx.tenantId }).returning();
      return row;
    },

    async findSentSubscriberIds(runArchiveId: string): Promise<Set<string>> {
      const rows = await db
        .select({ subscriberId: emailSends.subscriberId })
        .from(emailSends)
        .where(
          ctx.allTenants
            ? eq(emailSends.runArchiveId, runArchiveId)
            : and(eq(emailSends.runArchiveId, runArchiveId), eq(emailSends.tenantId, ctx.tenantId)),
        );
      return new Set(rows.map((r) => r.subscriberId));
    },
  };
}
