import { z } from "zod";
import type { UserSettings } from "@newsletter/shared";

const hnConfigSchema = z.object({
  keywords: z.array(z.string()).optional(),
  pointsThreshold: z.number().int().min(0).optional(),
  sinceDays: z.number().int().min(1).max(30),
  feeds: z.array(z.enum(["newest", "best"])).min(1).optional(),
  count: z.number().int().min(1).max(1000).optional(),
  commentsPerItem: z.number().int().min(0).max(100).optional(),
});

const redditConfigSchema = z.object({
  subreddits: z.array(z.string().min(1)).min(1),
  sort: z.enum(["hot", "new", "top"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sinceDays: z.number().int().min(1).max(30),
});

const TWITTER_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

const twitterUserInputSchema = z.object({
  handle: z
    .string()
    .regex(TWITTER_HANDLE_RE, {
      message:
        "handle must be 1-15 chars of letters, digits, or underscore (no @)",
    }),
  userId: z
    .string()
    .regex(/^\d+$/, { message: "userId must be a digit string" })
    .optional(),
});

const twitterUserPersistedSchema = z.object({
  handle: z.string().regex(TWITTER_HANDLE_RE),
  userId: z.string().regex(/^\d+$/),
});

export const twitterConfigInputSchema = z.object({
  listIds: z.array(
    z
      .string()
      .regex(/^\d+$/, { message: "listId must be a digit string" }),
  ),
  users: z.array(twitterUserInputSchema),
  maxTweetsPerSource: z.number().int().min(1).max(500).optional(),
  sinceHours: z.number().int().min(1).max(168).optional(),
});

const twitterConfigPersistedSchema = z.object({
  listIds: z.array(z.string().regex(/^\d+$/)),
  users: z.array(twitterUserPersistedSchema),
  maxTweetsPerSource: z.number().int().min(1).max(500).optional(),
  sinceHours: z.number().int().min(1).max(168).optional(),
});

export type TwitterConfigInput = z.infer<typeof twitterConfigInputSchema>;
export type TwitterUserInput = z.infer<typeof twitterUserInputSchema>;

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

export const runSubmitSchema = z
  .object({
    topN: z.number().int().min(1).max(50),
    hn: hnConfigSchema.optional(),
    reddit: redditConfigSchema.optional(),
    web: webConfigSchema.optional(),
    halfLifeHours: z.number().positive().optional(),
  })
  .refine(
    (payload) =>
      payload.hn !== undefined ||
      payload.reddit !== undefined ||
      payload.web !== undefined,
    { message: "at least one of hn, reddit, web is required" },
  );

export type RunSubmitBody = z.infer<typeof runSubmitSchema>;

const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const userSettingsCommonShape = {
  topN: z.number().int().min(1).max(50),
  halfLifeHours: z.number().positive().nullable(),
  hnConfig: hnConfigSchema.nullable(),
  redditConfig: redditConfigSchema.nullable(),
  webConfig: webConfigSchema.nullable(),
  scheduleTime: z
    .string()
    .regex(HH_MM_RE, { message: "scheduleTime must be HH:MM (24h)" }),
  scheduleTimezone: z
    .string()
    .min(1)
    .refine(isValidIanaTimezone, {
      message: "scheduleTimezone must be a valid IANA timezone",
    }),
  scheduleEnabled: z.boolean(),
} as const;

const sourcesPresentRefinement = (payload: {
  scheduleEnabled: boolean;
  hnConfig: unknown;
  redditConfig: unknown;
  webConfig: unknown;
}): boolean =>
  !payload.scheduleEnabled ||
  payload.hnConfig !== null ||
  payload.redditConfig !== null ||
  payload.webConfig !== null;

const sourcesPresentMessage = {
  message:
    "at least one source must be enabled when scheduleEnabled is true",
};

export const userSettingsUpsertSchema = z
  .object({
    ...userSettingsCommonShape,
    twitterConfig: twitterConfigInputSchema.nullable(),
  })
  .refine(sourcesPresentRefinement, sourcesPresentMessage);

export type UserSettingsUpsertBody = z.infer<typeof userSettingsUpsertSchema>;

export const userSettingsPersistedSchema = z
  .object({
    ...userSettingsCommonShape,
    twitterConfig: twitterConfigPersistedSchema.nullable(),
  })
  .refine(
    sourcesPresentRefinement,
    sourcesPresentMessage,
  ) satisfies z.ZodType<Omit<UserSettings, "id" | "updatedAt">>;

export type UserSettingsPersistedBody = z.infer<typeof userSettingsPersistedSchema>;

export const archivePatchSchema = z
  .object({
    rankedItems: z
      .array(
        z.object({
          id: z.number().int(),
          sourceType: z.string().min(1),
          summary: z.string().optional(),
          bullets: z.array(z.string()).optional(),
          bottomLine: z.string().optional(),
          imageUrl: z.string().nullable().optional(),
        }),
      )
      .min(1, { message: "rankedItems cannot be empty" })
      .refine(
        (items) => new Set(items.map((i) => i.id)).size === items.length,
        { message: "rankedItems contains duplicate ids" },
      ),
  });

export type ArchivePatchBody = z.infer<typeof archivePatchSchema>;

export const addPostSchema = z.object({
  url: z.url(),
});

export type AddPostBody = z.infer<typeof addPostSchema>;

export const promoteSchema = z.object({
  rawItemId: z.number().int().positive(),
});

export type PromoteBody = z.infer<typeof promoteSchema>;
