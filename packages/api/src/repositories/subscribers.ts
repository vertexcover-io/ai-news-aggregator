import { and, count, eq, inArray, ne } from "drizzle-orm";
import { subscribers } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SubscriberInsert, SubscriberSelect, SubscriberStatus } from "@newsletter/shared";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface SubscriberStatusUpdateResult {
  readonly changed: boolean;
  readonly next: SubscriberStatus;
  readonly row: SubscriberSelect;
}

export interface SubscribersRepo {
  findByEmail(email: string): Promise<SubscriberSelect | null>;
  findById(id: string): Promise<SubscriberSelect | null>;
  findByIds(ids: string[]): Promise<SubscriberSelect[]>;
  create(insert: SubscriberInsert): Promise<SubscriberSelect>;
  updateConfirmToken(
    id: string,
    confirmToken: string,
    confirmTokenExpiresAt: Date,
  ): Promise<void>;
  updateStatus(
    id: string,
    status: SubscriberStatus,
    extra?: {
      subscribedAt?: Date;
      unsubscribedAt?: Date;
      confirmToken?: null;
      confirmTokenExpiresAt?: null;
    },
  ): Promise<SubscriberStatusUpdateResult>;
  listConfirmed(): Promise<SubscriberSelect[]>;
  countConfirmed(): Promise<number>;
}

export function createSubscribersRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
  ctx: TenantContext,
): SubscribersRepo {
  return {
    async findByEmail(email: string): Promise<SubscriberSelect | null> {
      const rows = await db
        .select()
        .from(subscribers)
        .where(
          ctx.allTenants
            ? eq(subscribers.email, email)
            : and(eq(subscribers.email, email), eq(subscribers.tenantId, ctx.tenantId)),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<SubscriberSelect | null> {
      const rows = await db
        .select()
        .from(subscribers)
        .where(
          ctx.allTenants
            ? eq(subscribers.id, id)
            : and(eq(subscribers.id, id), eq(subscribers.tenantId, ctx.tenantId)),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async findByIds(ids: string[]): Promise<SubscriberSelect[]> {
      if (ids.length === 0) return [];
      const conditions = [inArray(subscribers.id, ids)];
      if (!ctx.allTenants) {
        conditions.push(eq(subscribers.tenantId, ctx.tenantId));
      }
      return db.select().from(subscribers).where(and(...conditions));
    },

    async create(insert: SubscriberInsert): Promise<SubscriberSelect> {
      const [row] = await db.insert(subscribers).values({ ...insert, tenantId: ctx.tenantId }).returning();
      return row;
    },

    async updateConfirmToken(
      id: string,
      confirmToken: string,
      confirmTokenExpiresAt: Date,
    ): Promise<void> {
      await db
        .update(subscribers)
        .set({ confirmToken, confirmTokenExpiresAt, updatedAt: new Date() })
        .where(
          ctx.allTenants
            ? eq(subscribers.id, id)
            : and(eq(subscribers.id, id), eq(subscribers.tenantId, ctx.tenantId)),
        );
    },

    async updateStatus(
      id: string,
      status: SubscriberStatus,
      extra?: {
        subscribedAt?: Date;
        unsubscribedAt?: Date;
        confirmToken?: null;
        confirmTokenExpiresAt?: null;
      },
    ): Promise<SubscriberStatusUpdateResult> {
      const statusWhere = ctx.allTenants
        ? and(eq(subscribers.id, id), ne(subscribers.status, status))
        : and(eq(subscribers.id, id), eq(subscribers.tenantId, ctx.tenantId), ne(subscribers.status, status));
      const updatedRows = await db
        .update(subscribers)
        .set({ status, updatedAt: new Date(), ...(extra ?? {}) })
        .where(statusWhere)
        .returning();
      for (const updated of updatedRows) {
        return { changed: true, next: status, row: updated };
      }
      const currentRows = await db
        .select()
        .from(subscribers)
        .where(
          ctx.allTenants
            ? eq(subscribers.id, id)
            : and(eq(subscribers.id, id), eq(subscribers.tenantId, ctx.tenantId)),
        )
        .limit(1);
      for (const current of currentRows) {
        return { changed: false, next: current.status, row: current };
      }
      throw new Error(`subscriber ${id} not found`);
    },

    async listConfirmed(): Promise<SubscriberSelect[]> {
      return db
        .select()
        .from(subscribers)
        .where(
          ctx.allTenants
            ? eq(subscribers.status, "confirmed")
            : and(eq(subscribers.status, "confirmed"), eq(subscribers.tenantId, ctx.tenantId)),
        );
    },

    async countConfirmed(): Promise<number> {
      const [row] = await db
        .select({ value: count() })
        .from(subscribers)
        .where(
          ctx.allTenants
            ? eq(subscribers.status, "confirmed")
            : and(eq(subscribers.status, "confirmed"), eq(subscribers.tenantId, ctx.tenantId)),
        );
      return row.value;
    },
  };
}
