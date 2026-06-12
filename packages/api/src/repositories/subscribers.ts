import { and, count, eq, inArray, ne } from "drizzle-orm";
import { subscribers } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SubscriberInsert, SubscriberSelect, SubscriberStatus } from "@newsletter/shared";

export interface SubscriberStatusUpdateResult {
  readonly changed: boolean;
  readonly next: SubscriberStatus;
  readonly row: SubscriberSelect;
}

export interface SubscribersRepo {
  findByEmail(email: string): Promise<SubscriberSelect | null>;
  findById(id: string): Promise<SubscriberSelect | null>;
  findByIds(ids: string[]): Promise<SubscriberSelect[]>;
  create(insert: Omit<SubscriberInsert, "tenantId">): Promise<SubscriberSelect>;
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
  tenantId: string,
): SubscribersRepo {
  return {
    async findByEmail(email: string): Promise<SubscriberSelect | null> {
      const rows = await db
        .select()
        .from(subscribers)
        .where(and(eq(subscribers.tenantId, tenantId), eq(subscribers.email, email)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<SubscriberSelect | null> {
      const rows = await db
        .select()
        .from(subscribers)
        .where(and(eq(subscribers.tenantId, tenantId), eq(subscribers.id, id)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByIds(ids: string[]): Promise<SubscriberSelect[]> {
      if (ids.length === 0) return [];
      return db
        .select()
        .from(subscribers)
        .where(and(eq(subscribers.tenantId, tenantId), inArray(subscribers.id, ids)));
    },

    async create(insert: Omit<SubscriberInsert, "tenantId">): Promise<SubscriberSelect> {
      const [row] = await db
        .insert(subscribers)
        .values({ ...insert, tenantId })
        .returning();
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
        .where(and(eq(subscribers.tenantId, tenantId), eq(subscribers.id, id)));
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
      const updatedRows = await db
        .update(subscribers)
        .set({ status, updatedAt: new Date(), ...(extra ?? {}) })
        .where(
          and(
            eq(subscribers.tenantId, tenantId),
            eq(subscribers.id, id),
            ne(subscribers.status, status),
          ),
        )
        .returning();
      for (const updated of updatedRows) {
        return { changed: true, next: status, row: updated };
      }
      const currentRows = await db
        .select()
        .from(subscribers)
        .where(and(eq(subscribers.tenantId, tenantId), eq(subscribers.id, id)))
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
        .where(and(eq(subscribers.tenantId, tenantId), eq(subscribers.status, "confirmed")));
    },

    async countConfirmed(): Promise<number> {
      const [row] = await db
        .select({ value: count() })
        .from(subscribers)
        .where(and(eq(subscribers.tenantId, tenantId), eq(subscribers.status, "confirmed")));
      return row.value;
    },
  };
}

export interface SubscriberTenantLookup {
  findById(id: string): Promise<SubscriberSelect | null>;
}

/**
 * NOT tenant-scoped by design: confirm/unsubscribe/feedback links arrive on
 * arbitrary hosts carrying only a signed subscriber token — the subscriber row
 * IS the tenancy resolution for those flows (same shape as the SES webhook's
 * messageId lookup). Use only from token-verified paths.
 */
export function createSubscriberTenantLookup(
  db: Pick<AppDb, "select">,
): SubscriberTenantLookup {
  return {
    async findById(id: string): Promise<SubscriberSelect | null> {
      const rows = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, id))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
