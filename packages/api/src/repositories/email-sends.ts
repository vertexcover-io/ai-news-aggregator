import { eq } from "drizzle-orm";
import { emailSends, tenantScope } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { EmailSendInsert, EmailSendSelect, TenantContext } from "@newsletter/shared";

export interface EmailSendsRepo {
  create(insert: EmailSendInsert): Promise<EmailSendSelect>;
  findSentSubscriberIds(runArchiveId: string): Promise<Set<string>>;
  findByMessageId(messageId: string): Promise<EmailSendSelect | null>;
}

export function createEmailSendsRepo(
  db: Pick<AppDb, "select" | "insert">,
  ctx?: TenantContext,
): EmailSendsRepo {
  const scope = tenantScope(emailSends.tenantId, ctx);
  return {
    async create(insert: EmailSendInsert): Promise<EmailSendSelect> {
      const [row] = await db.insert(emailSends).values(scope.stamp(insert)).returning();
      return row;
    },

    async findSentSubscriberIds(runArchiveId: string): Promise<Set<string>> {
      const rows = await db
        .select({ subscriberId: emailSends.subscriberId })
        .from(emailSends)
        .where(scope.where(eq(emailSends.runArchiveId, runArchiveId)));
      return new Set(rows.map((r) => r.subscriberId));
    },

    async findByMessageId(messageId: string): Promise<EmailSendSelect | null> {
      const rows = await db
        .select()
        .from(emailSends)
        .where(scope.where(eq(emailSends.messageId, messageId)))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
