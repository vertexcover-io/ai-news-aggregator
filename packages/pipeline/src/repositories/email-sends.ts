import { and, eq } from "drizzle-orm";
import { emailSends } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { EmailSendInsert, EmailSendSelect } from "@newsletter/shared";

export type EmailSendCreateInput = Omit<EmailSendInsert, "tenantId">;

export interface PipelineEmailSendsRepo {
  create(insert: EmailSendCreateInput): Promise<EmailSendSelect>;
  findSentSubscriberIds(runArchiveId: string): Promise<Set<string>>;
}

export function createPipelineEmailSendsRepo(
  db: Pick<AppDb, "select" | "insert">,
  tenantId: string,
): PipelineEmailSendsRepo {
  return {
    async create(insert: EmailSendCreateInput): Promise<EmailSendSelect> {
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
  };
}
