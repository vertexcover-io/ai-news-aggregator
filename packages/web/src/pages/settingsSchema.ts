import { z } from "zod";
import type {
  RunSubmitHnConfig,
  RunSubmitRedditConfig,
  RunSubmitWebConfig,
} from "@newsletter/shared";

const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const hnConfigSchema = z.object({
  keywords: z.array(z.string()).optional(),
  pointsThreshold: z.number().int().min(0).optional(),
  sinceDays: z.number().int().min(1).max(30),
  feeds: z.array(z.enum(["newest", "best"])).min(1).optional(),
  count: z.number().int().min(1).max(1000).optional(),
  commentsPerItem: z.number().int().min(0).max(100).optional(),
});

const redditConfigSchema = z.object({
  subreddits: z.array(z.string()).min(1),
  sort: z.enum(["hot", "new", "top"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sinceDays: z.number().int().min(1).max(30),
});

const twitterUserSchema = z.object({
  handle: z.string(),
  userId: z.string().optional(),
});

const twitterListSchema = z.object({
  value: z.string(),
});

const twitterConfigSchema = z.object({
  listIds: z.array(twitterListSchema),
  users: z.array(twitterUserSchema),
  maxTweetsPerSource: z.number().int().min(1).max(500).optional(),
  sinceHours: z.number().int().min(1).max(168).optional(),
});

export type TwitterFormConfig = z.infer<typeof twitterConfigSchema>;
export type TwitterFormUser = z.infer<typeof twitterUserSchema>;

export interface SettingsSubmitTwitterConfig {
  listIds: string[];
  users: { handle: string; userId?: string }[];
  maxTweetsPerSource?: number;
  sinceHours?: number;
}

export interface SettingsSubmitInput {
  topN: number;
  halfLifeHours: number | null;
  hnEnabled: boolean;
  hnConfig: RunSubmitHnConfig | null;
  redditEnabled: boolean;
  redditConfig: RunSubmitRedditConfig | null;
  webEnabled: boolean;
  webConfig: RunSubmitWebConfig | null;
  twitterEnabled: boolean;
  twitterConfig: SettingsSubmitTwitterConfig | null;
  scheduleTime: string;
  scheduleTimezone: string;
  scheduleEnabled: boolean;
  rankingWorkflow: string;
}

const webConfigSchema = z.object({
  sources: z
    .array(
      z.object({
        name: z.string().min(1),
        listingUrl: z.url(),
      }),
    )
    .min(1),
  maxItems: z.number().int().min(1).max(100),
  sinceDays: z.number().int().min(1).optional(),
});

export const settingsFormSchema = z
  .object({
    topN: z.number().int().min(1).max(50),
    halfLifeHours: z.number().positive().nullable(),
    hnEnabled: z.boolean(),
    hnConfig: hnConfigSchema.nullable(),
    redditEnabled: z.boolean(),
    redditConfig: redditConfigSchema.nullable(),
    webEnabled: z.boolean(),
    webConfig: webConfigSchema.nullable(),
    twitterEnabled: z.boolean(),
    twitterConfig: twitterConfigSchema.nullable(),
    scheduleTime: z
      .string()
      .regex(HH_MM_RE, { message: "scheduleTime must be HH:MM (24h)" }),
    scheduleTimezone: z.string().min(1).refine(isValidIanaTimezone, {
      message: "scheduleTimezone must be a valid IANA timezone",
    }),
    scheduleEnabled: z.boolean(),
    rankingWorkflow: z.string().max(8000),
  })
  .refine(
    (payload) =>
      !payload.scheduleEnabled ||
      payload.hnEnabled ||
      payload.redditEnabled ||
      payload.webEnabled ||
      payload.twitterEnabled,
    {
      message:
        "at least one source must be enabled when scheduleEnabled is true",
      path: ["scheduleEnabled"],
    },
  );

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export function normalizeTwitterConfigForSubmit(
  config: TwitterFormConfig | null,
): SettingsSubmitTwitterConfig | null {
  if (config === null) return null;

  const listIds = config.listIds
    .map((row) => row.value.trim())
    .filter((s) => s.length > 0);

  const users: { handle: string; userId?: string }[] = [];
  for (const u of config.users) {
    const handle = u.handle.trim().replace(/^@+/, "");
    if (handle.length === 0) continue;
    const userId = u.userId?.trim() ?? "";
    if (userId.length > 0) {
      users.push({ handle, userId });
    } else {
      users.push({ handle });
    }
  }

  if (listIds.length === 0 && users.length === 0) return null;

  return {
    listIds,
    users,
    maxTweetsPerSource: config.maxTweetsPerSource,
    sinceHours: config.sinceHours,
  };
}

export function normalizeSettingsForSubmit(
  values: SettingsFormValues,
): SettingsSubmitInput {
  const hnConfig = values.hnConfig
    ? {
        ...values.hnConfig,
        keywords: values.hnConfig.keywords
          ?.map((k) => k.trim())
          .filter(Boolean),
      }
    : values.hnConfig;
  const redditConfig = values.redditConfig
    ? {
        ...values.redditConfig,
        subreddits: values.redditConfig.subreddits
          .map((s) => s.trim())
          .filter(Boolean),
      }
    : values.redditConfig;
  return {
    topN: values.topN,
    halfLifeHours: values.halfLifeHours,
    hnEnabled: values.hnEnabled,
    hnConfig,
    redditEnabled: values.redditEnabled,
    redditConfig,
    webEnabled: values.webEnabled,
    webConfig: values.webConfig,
    twitterEnabled: values.twitterEnabled,
    twitterConfig: normalizeTwitterConfigForSubmit(values.twitterConfig),
    scheduleTime: values.scheduleTime,
    scheduleTimezone: values.scheduleTimezone,
    scheduleEnabled: values.scheduleEnabled,
    rankingWorkflow: values.rankingWorkflow,
  };
}
