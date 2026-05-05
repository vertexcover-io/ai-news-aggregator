import { eq } from "drizzle-orm";
import { emailSends } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { EmailSendInsert, EmailSendSelect } from "@newsletter/shared";

export interface PipelineEmailSendsRepo {
  create(insert: EmailSendInsert): Promise<EmailSendSelect>;
  findSentSubscriberIds(runArchiveId: string): Promise<Set<string>>;
}

export function createPipelineEmailSendsRepo(
  db: Pick<AppDb, "select" | "insert">,
): PipelineEmailSendsRepo {
  return {
    async create(insert: EmailSendInsert): Promise<EmailSendSelect> {
      const [row] = await db.insert(emailSends).values(insert).returning();
      return row;
    },

    async findSentSubscriberIds(runArchiveId: string): Promise<Set<string>> {
      const rows = await db
        .select({ subscriberId: emailSends.subscriberId })
        .from(emailSends)
        .where(eq(emailSends.runArchiveId, runArchiveId));
      return new Set(rows.map((r) => r.subscriberId));
    },
  };
}
