import { eq } from "drizzle-orm";
import { userSettings } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { UserSettings } from "@newsletter/shared";
import type { EncryptedBlob } from "@newsletter/shared/services/credential-cipher";

export type UserSettingsUpsertInput = Omit<UserSettings, "id" | "updatedAt" | "scheduleTime"> & {
  readonly scheduleTime?: string;
};

export interface UserSettingsRepo {
  get(): Promise<UserSettings | null>;
  upsert(input: UserSettingsUpsertInput): Promise<UserSettings>;
}

export interface TenantNotificationSettings {
  notificationEmail: string | null;
  slackWebhookEncrypted: EncryptedBlob | null;
}

export interface NotificationSettingsUpdate {
  notificationEmail?: string | null;
  slackWebhookEncrypted?: EncryptedBlob | null;
}

export interface NotificationSettingsRepo {
  get(): Promise<TenantNotificationSettings | null>;
  /** Partial update: omitted fields stay untouched; null clears. No-op when the settings row is missing. */
  update(input: NotificationSettingsUpdate): Promise<void>;
}

export function createNotificationSettingsRepo(
  db: Pick<AppDb, "select" | "update">,
  tenantId: string,
): NotificationSettingsRepo {
  return {
    async get(): Promise<TenantNotificationSettings | null> {
      const rows = await db
        .select({
          notificationEmail: userSettings.notificationEmail,
          slackWebhookEncrypted: userSettings.slackWebhookEncrypted,
        })
        .from(userSettings)
        .where(eq(userSettings.tenantId, tenantId))
        .limit(1);
      if (rows.length === 0) return null;
      return {
        notificationEmail: rows[0].notificationEmail ?? null,
        slackWebhookEncrypted: rows[0].slackWebhookEncrypted ?? null,
      };
    },

    async update(input: NotificationSettingsUpdate): Promise<void> {
      const set: Partial<typeof userSettings.$inferInsert> = {};
      if (input.notificationEmail !== undefined) {
        set.notificationEmail = input.notificationEmail;
      }
      if (input.slackWebhookEncrypted !== undefined) {
        set.slackWebhookEncrypted = input.slackWebhookEncrypted;
      }
      if (Object.keys(set).length === 0) return;
      await db
        .update(userSettings)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(userSettings.tenantId, tenantId));
    },
  };
}

function toDomain(
  row: typeof userSettings.$inferSelect,
): UserSettings {
  const pipelineTime = row.pipelineTime;
  return {
    id: row.id,
    topN: row.topN,
    halfLifeHours: row.halfLifeHours,
    hnEnabled: row.hnEnabled,
    hnConfig: row.hnConfig ?? null,
    redditEnabled: row.redditEnabled,
    redditConfig: row.redditConfig ?? null,
    webEnabled: row.webEnabled,
    webConfig: row.webConfig ?? null,
    twitterEnabled: row.twitterEnabled,
    twitterConfig: row.twitterConfig ?? null,
    webSearchEnabled: row.webSearchEnabled,
    webSearchConfig: row.webSearchConfig ?? null,
    posthogEnabled: row.posthogEnabled,
    posthogProjectToken: row.posthogProjectToken ?? null,
    posthogHost: row.posthogHost ?? null,
    scheduleTime: pipelineTime,
    pipelineTime,
    emailTime: row.emailTime,
    linkedinTime: row.linkedinTime,
    twitterTime: row.twitterTime,
    scheduleTimezone: row.scheduleTimezone,
    scheduleEnabled: row.scheduleEnabled,
    emailEnabled: row.emailEnabled,
    linkedinEnabled: row.linkedinEnabled,
    twitterPostEnabled: row.twitterPostEnabled,
    autoReview: row.autoReview,
    rankingPrompt: row.rankingPrompt,
    shortlistPrompt: row.shortlistPrompt,
    shortlistSize: row.shortlistSize,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createUserSettingsRepo(
  db: Pick<AppDb, "select" | "insert">,
  tenantId: string,
): UserSettingsRepo {
  return {
    async get(): Promise<UserSettings | null> {
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.tenantId, tenantId))
        .limit(1);
      if (rows.length === 0) return null;
      return toDomain(rows[0]);
    },

    async upsert(input: UserSettingsUpsertInput): Promise<UserSettings> {
      const now = new Date();
      const pipelineTime = input.pipelineTime;
      const [row] = await db
        .insert(userSettings)
        .values({
          tenantId,
          singleton: true,
          topN: input.topN,
          halfLifeHours: input.halfLifeHours,
          hnEnabled: input.hnEnabled,
          hnConfig: input.hnConfig ?? null,
          redditEnabled: input.redditEnabled,
          redditConfig: input.redditConfig ?? null,
          webEnabled: input.webEnabled,
          webConfig: input.webConfig ?? null,
          twitterEnabled: input.twitterEnabled,
          twitterConfig: input.twitterConfig ?? null,
          webSearchEnabled: input.webSearchEnabled,
          webSearchConfig: input.webSearchConfig ?? null,
          posthogEnabled: input.posthogEnabled,
          posthogProjectToken: input.posthogProjectToken,
          posthogHost: input.posthogHost,
          pipelineTime,
          emailTime: input.emailTime,
          linkedinTime: input.linkedinTime,
          twitterTime: input.twitterTime,
          scheduleTimezone: input.scheduleTimezone,
          scheduleEnabled: input.scheduleEnabled,
          emailEnabled: input.emailEnabled,
          linkedinEnabled: input.linkedinEnabled,
          twitterPostEnabled: input.twitterPostEnabled,
          autoReview: input.autoReview,
          rankingPrompt: input.rankingPrompt,
          shortlistPrompt: input.shortlistPrompt,
          shortlistSize: input.shortlistSize,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userSettings.tenantId,
          set: {
            topN: input.topN,
            halfLifeHours: input.halfLifeHours,
            hnEnabled: input.hnEnabled,
            hnConfig: input.hnConfig,
            redditEnabled: input.redditEnabled,
            redditConfig: input.redditConfig,
            webEnabled: input.webEnabled,
            webConfig: input.webConfig,
            twitterEnabled: input.twitterEnabled,
            twitterConfig: input.twitterConfig,
            webSearchEnabled: input.webSearchEnabled,
            webSearchConfig: input.webSearchConfig,
            posthogEnabled: input.posthogEnabled,
            posthogProjectToken: input.posthogProjectToken,
            posthogHost: input.posthogHost,
            pipelineTime,
            emailTime: input.emailTime,
            linkedinTime: input.linkedinTime,
            twitterTime: input.twitterTime,
            scheduleTimezone: input.scheduleTimezone,
            scheduleEnabled: input.scheduleEnabled,
            emailEnabled: input.emailEnabled,
            linkedinEnabled: input.linkedinEnabled,
            twitterPostEnabled: input.twitterPostEnabled,
            autoReview: input.autoReview,
            rankingPrompt: input.rankingPrompt,
            shortlistPrompt: input.shortlistPrompt,
            shortlistSize: input.shortlistSize,
            updatedAt: now,
          },
        })
        .returning();
      return toDomain(row);
    },
  };
}
