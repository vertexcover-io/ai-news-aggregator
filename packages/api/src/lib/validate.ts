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

export const runNowBodySchema = z
  .object({ dryRun: z.boolean().optional() })
  .strict();

export type RunNowBody = z.infer<typeof runNowBodySchema>;

const HH_MM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmmSchema = z
  .string()
  .regex(HH_MM_RE, { message: "time must be HH:MM (24h)" });

const nullableTrimmedStringSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(1).nullable(),
);

const nullableUrlSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.url().nullable(),
);

function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

const webSearchQueryConfigSchema = z.object({
  query: z.string().trim().min(1).max(400),
  sinceDays: z.number().int().min(1).max(30),
  maxItems: z.number().int().min(1).max(20),
});

const webSearchConfigSchema = z.object({
  provider: z.literal("tavily"),
  queries: z.array(webSearchQueryConfigSchema).max(25),
});

const userSettingsCommonShape = {
  topN: z.number().int().min(1).max(50),
  halfLifeHours: z.number().positive().nullable(),
  hnEnabled: z.boolean(),
  hnConfig: hnConfigSchema.nullable(),
  redditEnabled: z.boolean(),
  redditConfig: redditConfigSchema.nullable(),
  webEnabled: z.boolean(),
  webConfig: webConfigSchema.nullable(),
  twitterEnabled: z.boolean(),
  webSearchEnabled: z.boolean().optional(),
  webSearchConfig: webSearchConfigSchema.nullable().optional(),
  posthogEnabled: z.boolean().default(false),
  posthogProjectToken: nullableTrimmedStringSchema.default(null),
  posthogHost: nullableUrlSchema.default(null),
  pipelineTime: hhmmSchema.optional(),
  scheduleTime: hhmmSchema.optional(),
  emailTime: hhmmSchema.optional(),
  linkedinTime: hhmmSchema.optional(),
  twitterTime: hhmmSchema.optional(),
  scheduleTimezone: z
    .string()
    .min(1)
    .refine(isValidIanaTimezone, {
      message: "scheduleTimezone must be a valid IANA timezone",
    }),
  scheduleEnabled: z.boolean(),
  emailEnabled: z.boolean().optional(),
  linkedinEnabled: z.boolean().optional(),
  twitterPostEnabled: z.boolean().optional(),
  autoReview: z.boolean().optional(),
  rankingPrompt: z
    .string()
    .max(20000, "Ranking prompt too long (max 20000 chars)")
    .refine((v) => v.trim().length > 0, "Ranking prompt is required"),
  shortlistPrompt: z
    .string()
    .max(20000, "Shortlist prompt too long (max 20000 chars)")
    .refine((v) => v.trim().length > 0, "Shortlist prompt is required"),
  shortlistSize: z.number().int().min(5).max(100),
} as const;

interface SourceEnabledPayload {
  scheduleEnabled: boolean;
  hnEnabled: boolean;
  redditEnabled: boolean;
  webEnabled: boolean;
  twitterEnabled: boolean;
  webSearchEnabled?: boolean;
}

const sourcesEnabledRefinement = (payload: SourceEnabledPayload): boolean =>
  !payload.scheduleEnabled ||
  payload.hnEnabled ||
  payload.redditEnabled ||
  payload.webEnabled ||
  payload.twitterEnabled ||
  (payload.webSearchEnabled ?? false);

const sourcesPresentMessage = {
  message:
    "at least one source must be enabled when scheduleEnabled is true",
};

function addEnabledConfigIssues(
  payload: {
    hnEnabled: boolean;
    hnConfig: unknown;
    redditEnabled: boolean;
    redditConfig: unknown;
    webEnabled: boolean;
    webConfig: unknown;
    twitterEnabled: boolean;
    twitterConfig: unknown;
    webSearchEnabled?: boolean;
    webSearchConfig?: unknown;
  },
  ctx: z.RefinementCtx,
): void {
  const pairs = [
    { enabled: payload.hnEnabled, config: payload.hnConfig, path: "hnConfig" },
    {
      enabled: payload.redditEnabled,
      config: payload.redditConfig,
      path: "redditConfig",
    },
    { enabled: payload.webEnabled, config: payload.webConfig, path: "webConfig" },
    {
      enabled: payload.twitterEnabled,
      config: payload.twitterConfig,
      path: "twitterConfig",
    },
    {
      enabled: payload.webSearchEnabled ?? false,
      config: payload.webSearchConfig ?? null,
      path: "webSearchConfig",
    },
  ] as const;

  pairs
    .filter(({ enabled, config }) => enabled && config === null)
    .forEach(({ path }) => {
      ctx.addIssue({
        code: "custom",
        message: "enabled source must include a config",
        path: [path],
      });
    });

  const wsConfig = payload.webSearchConfig;
  if (
    (payload.webSearchEnabled ?? false) &&
    wsConfig !== null &&
    wsConfig !== undefined &&
    typeof wsConfig === "object" &&
    "queries" in wsConfig &&
    Array.isArray(wsConfig.queries) &&
    wsConfig.queries.length === 0
  ) {
    ctx.addIssue({
      code: "custom",
      message: "webSearchConfig.queries must not be empty when webSearchEnabled is true",
      path: ["webSearchConfig", "queries"],
    });
  }
}

function minutesFromHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function addMinutesToHHMM(hhmm: string, minutesToAdd: number): string {
  const dayMinutes = 24 * 60;
  const total = (minutesFromHHMM(hhmm) + minutesToAdd + dayMinutes) % dayMinutes;
  const h = Math.floor(total / 60).toString().padStart(2, "0");
  const m = (total % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function addScheduleOrderingIssues(
  payload: {
    pipelineTime: string;
    emailTime: string;
    linkedinTime: string;
    twitterTime: string;
  },
  ctx: z.RefinementCtx,
): void {
  const pipelineMinutes = minutesFromHHMM(payload.pipelineTime);
  ([
    "emailTime",
    "linkedinTime",
    "twitterTime",
  ] as const).forEach((field) => {
    if (minutesFromHHMM(payload[field]) === pipelineMinutes) {
      ctx.addIssue({
        code: "custom",
        message: "must differ from pipelineTime",
        path: [field],
      });
    }
  });
}

export const userSettingsUpsertSchema = z
  .object({
    ...userSettingsCommonShape,
    hnEnabled: z.boolean().optional(),
    redditEnabled: z.boolean().optional(),
    webEnabled: z.boolean().optional(),
    twitterEnabled: z.boolean().optional(),
    twitterConfig: twitterConfigInputSchema.nullable(),
  })
  .transform((payload) => ({
    ...payload,
    pipelineTime: payload.pipelineTime ?? payload.scheduleTime,
    emailTime: payload.emailTime ?? addMinutesToHHMM(payload.pipelineTime ?? payload.scheduleTime ?? "00:00", 30),
    linkedinTime: payload.linkedinTime ?? addMinutesToHHMM(payload.pipelineTime ?? payload.scheduleTime ?? "00:00", 30),
    twitterTime: payload.twitterTime ?? addMinutesToHHMM(payload.pipelineTime ?? payload.scheduleTime ?? "00:00", 30),
    emailEnabled: payload.emailEnabled ?? true,
    linkedinEnabled: payload.linkedinEnabled ?? true,
    twitterPostEnabled: payload.twitterPostEnabled ?? true,
    autoReview: payload.autoReview ?? false,
    hnEnabled: payload.hnEnabled ?? payload.hnConfig !== null,
    redditEnabled: payload.redditEnabled ?? payload.redditConfig !== null,
    webEnabled: payload.webEnabled ?? payload.webConfig !== null,
    twitterEnabled: payload.twitterEnabled ?? payload.twitterConfig !== null,
    webSearchEnabled: payload.webSearchEnabled ?? (payload.webSearchConfig != null),
    webSearchConfig: payload.webSearchConfig ?? null,
  }))
  .pipe(
    z.object({
      ...userSettingsCommonShape,
      posthogEnabled: z.boolean(),
      posthogProjectToken: z.string().nullable(),
      posthogHost: z.string().nullable(),
      pipelineTime: hhmmSchema,
      scheduleTime: hhmmSchema.optional(),
      emailTime: hhmmSchema,
      linkedinTime: hhmmSchema,
      twitterTime: hhmmSchema,
      emailEnabled: z.boolean(),
      linkedinEnabled: z.boolean(),
      twitterPostEnabled: z.boolean(),
      autoReview: z.boolean(),
      hnEnabled: z.boolean(),
      redditEnabled: z.boolean(),
      webEnabled: z.boolean(),
      twitterEnabled: z.boolean(),
      twitterConfig: twitterConfigInputSchema.nullable(),
      webSearchEnabled: z.boolean(),
      webSearchConfig: webSearchConfigSchema.nullable(),
    }),
  )
  .superRefine((payload, ctx) => {
    if (!sourcesEnabledRefinement(payload)) {
      ctx.addIssue({ code: "custom", ...sourcesPresentMessage });
    }
    addEnabledConfigIssues(payload, ctx);
    addScheduleOrderingIssues(payload, ctx);
  });

export type UserSettingsUpsertBody = z.infer<typeof userSettingsUpsertSchema>;

export const userSettingsPersistedSchema = z
  .object({
    ...userSettingsCommonShape,
    pipelineTime: hhmmSchema,
    emailTime: hhmmSchema,
    linkedinTime: hhmmSchema,
    twitterTime: hhmmSchema,
    emailEnabled: z.boolean(),
    linkedinEnabled: z.boolean(),
    twitterPostEnabled: z.boolean(),
    autoReview: z.boolean(),
    twitterConfig: twitterConfigPersistedSchema.nullable(),
    webSearchEnabled: z.boolean(),
    webSearchConfig: webSearchConfigSchema.nullable(),
  })
  .superRefine((payload, ctx) => {
    if (!sourcesEnabledRefinement(payload)) {
      ctx.addIssue({ code: "custom", ...sourcesPresentMessage });
    }
    addEnabledConfigIssues(payload, ctx);
    addScheduleOrderingIssues(payload, ctx);
  }) satisfies z.ZodType<Omit<UserSettings, "id" | "updatedAt" | "scheduleTime">>;

export type UserSettingsPersistedBody = z.infer<typeof userSettingsPersistedSchema>;

export const archivePatchSchema = z
  .object({
    rankedItems: z
      .array(
        z.object({
          id: z.number().int(),
          sourceType: z.string().min(1),
          title: z.string().min(1).max(160).optional(),
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
    digestHeadline: z.string().nullable().optional(),
    digestSummary: z.string().nullable().optional(),
    hook: z.string().nullable().optional(),
    twitterSummary: z.string().nullable().optional(),
    linkedinPostBody: z.string().nullable().optional(),
  });

export type ArchivePatchBody = z.infer<typeof archivePatchSchema>;

export const regenerateDigestMetaSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int(),
        title: z.string().min(1),
        summary: z.string(),
        bottomLine: z.string(),
      }),
    )
    .min(1, { message: "items cannot be empty" }),
});

export type RegenerateDigestMetaBody = z.infer<typeof regenerateDigestMetaSchema>;

export const addPostSchema = z.object({
  url: z.url(),
});

export const socialChannelSchema = z.enum(["linkedin", "twitter"]);

export type SocialChannel = z.infer<typeof socialChannelSchema>;

export type AddPostBody = z.infer<typeof addPostSchema>;

export const promoteSchema = z.object({
  rawItemId: z.number().int().positive(),
});

export type PromoteBody = z.infer<typeof promoteSchema>;
