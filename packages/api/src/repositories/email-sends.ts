import { and, eq } from "drizzle-orm";
import { isAllTenants, type ScopedTenantContext } from "@newsletter/shared/services";
import { emailSends } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { EmailSendInsert, EmailSendSelect } from "@newsletter/shared";

export interface EmailSendsRepo {
  create(insert: EmailSendInsert): Promise<EmailSendSelect>;
  findSentSubscriberIds(runArchiveId: string): Promise<Set<string>>;
  findByMessageId(messageId: string): Promise<EmailSendSelect | null>;
}

export function createEmailSendsRepo(
  db: Pick<AppDb, "select" | "insert">,
  scoped: ScopedTenantContext,
): EmailSendsRepo {
  const tid = () => isAllTenants(scoped) ? [] : [eq(emailSends.tenantId, scoped.ctx.tenantId)];

  return {
    async create(insert: EmailSendInsert): Promise<EmailSendSelect> {
      const [row] = await db.insert(emailSends).values({
        ...insert,
        ...(isAllTenants(scoped) ? {} : { tenantId: scoped.ctx.tenantId }),
      }).returning();
      return row;
    },

    async findSentSubscriberIds(runArchiveId: string): Promise<Set<string>> {
      const rows = await db
        .select({ subscriberId: emailSends.subscriberId })
        .from(emailSends)
        .where(and(eq(emailSends.runArchiveId, runArchiveId), ...tid()));
      return new Set(rows.map((r) => r.subscriberId));
    },

    async findByMessageId(messageId: string): Promise<EmailSendSelect | null> {
      const rows = await db
        .select()
        .from(emailSends)
        .where(and(eq(emailSends.messageId, messageId), ...tid()))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
