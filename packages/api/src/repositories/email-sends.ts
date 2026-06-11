import { and, eq } from "drizzle-orm";
import { emailSends } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { EmailSendInsert, EmailSendSelect } from "@newsletter/shared";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface EmailSendsRepo {
  create(insert: EmailSendInsert): Promise<EmailSendSelect>;
  findSentSubscriberIds(runArchiveId: string): Promise<Set<string>>;
  findByMessageId(messageId: string): Promise<EmailSendSelect | null>;
}

export function createEmailSendsRepo(
  db: Pick<AppDb, "select" | "insert">,
  ctx: TenantContext,
): EmailSendsRepo {
  return {
    async create(insert: EmailSendInsert): Promise<EmailSendSelect> {
      const [row] = await db
        .insert(emailSends)
        .values({ ...insert, tenantId: ctx.tenantId })
        .returning();
      return row;
    },

    async findSentSubscriberIds(runArchiveId: string): Promise<Set<string>> {
      const conditions = [eq(emailSends.runArchiveId, runArchiveId)];
      if (!ctx.allTenants) conditions.push(eq(emailSends.tenantId, ctx.tenantId));
      const rows = await db
        .select({ subscriberId: emailSends.subscriberId })
        .from(emailSends)
        .where(and(...conditions));
      return new Set(rows.map((r) => r.subscriberId));
    },

    async findByMessageId(messageId: string): Promise<EmailSendSelect | null> {
      const conditions = [eq(emailSends.messageId, messageId)];
      if (!ctx.allTenants) conditions.push(eq(emailSends.tenantId, ctx.tenantId));
      const rows = await db
        .select()
        .from(emailSends)
        .where(and(...conditions))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
