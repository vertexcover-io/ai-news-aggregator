import type { AppDb } from "@newsletter/shared/db";
import { subscribers, emailSends, sesEvents } from "@newsletter/shared/db";
import { and, gte, lt, eq, count } from "drizzle-orm";
import type { TenantContext } from "@newsletter/shared/types/tenant-context";

export interface AnalyticsRepo {
  getMetrics(params: { from: Date; to: Date }): Promise<{
    totalSubscriptions: number;
    totalUnsubscriptions: number;
    emailsSent: number;
    bounces: number;
    complaints: number;
    opens: number;
    clicks: number;
  }>;
}

export function createAnalyticsRepo(db: Pick<AppDb, "select">, ctx: TenantContext): AnalyticsRepo {
  const subTenant = ctx.allTenants ? undefined : eq(subscribers.tenantId, ctx.tenantId);
  const sendTenant = ctx.allTenants ? undefined : eq(emailSends.tenantId, ctx.tenantId);
  const sesTenant = ctx.allTenants ? undefined : eq(sesEvents.tenantId, ctx.tenantId);

  return {
    async getMetrics({ from, to }) {
      const [
        subscriptionsResult,
        unsubscriptionsResult,
        emailsSentResult,
        bouncesResult,
        complaintsResult,
        opensResult,
        clicksResult,
      ] = await Promise.all([
        db
        .select({ value: count() })
        .from(subscribers)
        .where(subTenant
          ? and(subTenant, gte(subscribers.subscribedAt, from), lt(subscribers.subscribedAt, to))
          : and(gte(subscribers.subscribedAt, from), lt(subscribers.subscribedAt, to))),
        db
        .select({ value: count() })
        .from(subscribers)
        .where(subTenant
          ? and(subTenant, gte(subscribers.unsubscribedAt, from), lt(subscribers.unsubscribedAt, to))
          : and(gte(subscribers.unsubscribedAt, from), lt(subscribers.unsubscribedAt, to))),
        db
        .select({ value: count() })
        .from(emailSends)
        .where(sendTenant
          ? and(sendTenant, gte(emailSends.sentAt, from), lt(emailSends.sentAt, to))
          : and(gte(emailSends.sentAt, from), lt(emailSends.sentAt, to))),
        db
        .select({ value: count() })
        .from(sesEvents)
        .where(sesTenant
          ? and(sesTenant, eq(sesEvents.eventType, "bounce"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))
          : and(eq(sesEvents.eventType, "bounce"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
        .select({ value: count() })
        .from(sesEvents)
        .where(sesTenant
          ? and(sesTenant, eq(sesEvents.eventType, "complaint"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))
          : and(eq(sesEvents.eventType, "complaint"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
        .select({ value: count() })
        .from(sesEvents)
        .where(sesTenant
          ? and(sesTenant, eq(sesEvents.eventType, "open"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))
          : and(eq(sesEvents.eventType, "open"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
        db
        .select({ value: count() })
        .from(sesEvents)
        .where(sesTenant
          ? and(sesTenant, eq(sesEvents.eventType, "click"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))
          : and(eq(sesEvents.eventType, "click"), gte(sesEvents.occurredAt, from), lt(sesEvents.occurredAt, to))),
      ]);

      return {
        totalSubscriptions: subscriptionsResult[0]?.value ?? 0,
        totalUnsubscriptions: unsubscriptionsResult[0]?.value ?? 0,
        emailsSent: emailsSentResult[0]?.value ?? 0,
        bounces: bouncesResult[0]?.value ?? 0,
        complaints: complaintsResult[0]?.value ?? 0,
        opens: opensResult[0]?.value ?? 0,
        clicks: clicksResult[0]?.value ?? 0,
      };
    },
  };
}
