import { and, eq } from "drizzle-orm";
import { emailSends } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { EmailSendInsert, EmailSendSelect } from "@newsletter/shared";

export interface EmailSendsRepo {
  create(insert: Omit<EmailSendInsert, "tenantId">): Promise<EmailSendSelect>;
  findSentSubscriberIds(runArchiveId: string): Promise<Set<string>>;
  findByMessageId(messageId: string): Promise<EmailSendSelect | null>;
}

export function createEmailSendsRepo(
  db: Pick<AppDb, "select" | "insert">,
  tenantId: string,
): EmailSendsRepo {
  return {
    async create(insert: Omit<EmailSendInsert, "tenantId">): Promise<EmailSendSelect> {
      const [row] = await db
        .insert(emailSends)
        .values({ ...insert, tenantId })
        .returning();
      return row;
    },

    async findSentSubscriberIds(runArchiveId: string): Promise<Set<string>> {
      const rows = await db
        .select({ subscriberId: emailSends.subscriberId })
        .from(emailSends)
        .where(
          and(
            eq(emailSends.tenantId, tenantId),
            eq(emailSends.runArchiveId, runArchiveId),
          ),
        );
      return new Set(rows.map((r) => r.subscriberId));
    },

    async findByMessageId(messageId: string): Promise<EmailSendSelect | null> {
      const rows = await db
        .select()
        .from(emailSends)
        .where(
          and(
            eq(emailSends.tenantId, tenantId),
            eq(emailSends.messageId, messageId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
  };
}

export interface EmailSendTenantLookup {
  findByMessageId(messageId: string): Promise<EmailSendSelect | null>;
}

/**
 * NOT tenant-scoped by design: SES webhook events arrive with no tenant
 * context — the email_send row referenced by the provider messageId IS the
 * tenancy resolution for the event. Use only from the SES webhook path.
 */
export function createEmailSendTenantLookup(
  db: Pick<AppDb, "select">,
): EmailSendTenantLookup {
  return {
    async findByMessageId(messageId: string): Promise<EmailSendSelect | null> {
      const rows = await db
        .select()
        .from(emailSends)
        .where(eq(emailSends.messageId, messageId))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
