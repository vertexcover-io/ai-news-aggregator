import { eq } from "drizzle-orm";
import { subscribers } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { SubscriberInsert, SubscriberSelect, SubscriberStatus } from "@newsletter/shared";

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
  ): Promise<SubscriberSelect>;
  listConfirmed(): Promise<SubscriberSelect[]>;
}

export function createSubscribersRepo(
  db: Pick<AppDb, "select" | "insert" | "update">,
): SubscribersRepo {
  return {
    async findByEmail(email: string): Promise<SubscriberSelect | null> {
      const rows = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async findById(id: string): Promise<SubscriberSelect | null> {
      const rows = await db
        .select()
        .from(subscribers)
        .where(eq(subscribers.id, id))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByIds(ids: string[]): Promise<SubscriberSelect[]> {
      if (ids.length === 0) return [];
      const { inArray } = await import("drizzle-orm");
      return db.select().from(subscribers).where(inArray(subscribers.id, ids));
    },

    async create(insert: SubscriberInsert): Promise<SubscriberSelect> {
      const [row] = await db.insert(subscribers).values(insert).returning();
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
        .where(eq(subscribers.id, id));
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
    ): Promise<SubscriberSelect> {
      const [row] = await db
        .update(subscribers)
        .set({ status, updatedAt: new Date(), ...extra })
        .where(eq(subscribers.id, id))
        .returning();
      return row;
    },

    async listConfirmed(): Promise<SubscriberSelect[]> {
      return db
        .select()
        .from(subscribers)
        .where(eq(subscribers.status, "confirmed"));
    },
  };
}
