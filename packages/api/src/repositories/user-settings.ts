import { eq } from "drizzle-orm";
import { userSettings } from "@newsletter/shared/db";
import type { AppDb } from "@newsletter/shared/db";
import type { UserSettings } from "@newsletter/shared";

export type UserSettingsUpsertInput = Omit<UserSettings, "id" | "updatedAt" | "scheduleTime"> & {
  readonly scheduleTime?: string;
};

export interface UserSettingsRepo {
  get(): Promise<UserSettings | null>;
  upsert(input: UserSettingsUpsertInput): Promise<UserSettings>;
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
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createUserSettingsRepo(
  db: Pick<AppDb, "select" | "insert">,
): UserSettingsRepo {
  return {
    async get(): Promise<UserSettings | null> {
      const rows = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.singleton, true))
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
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userSettings.singleton,
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
            updatedAt: now,
          },
        })
        .returning();
      return toDomain(row);
    },
  };
}
