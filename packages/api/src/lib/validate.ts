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

export const webSearchConfigInputSchema = z.object({
  provider: z.literal("tavily"),
  queries: z
    .array(
      z.object({
        query: z.string().trim().min(1).max(400),
        sinceDays: z.number().int().min(1).max(30),
        maxItems: z.number().int().min(1).max(20),
      }),
    )
    .max(25),
});

export const runSubmitSchema = z
  .object({
    topN: z.number().int().min(1).max(50),
    hn: hnConfigSchema.optional(),
    reddit: redditConfigSchema.optional(),
    web: webConfigSchema.optional(),
    webSearch: webSearchConfigInputSchema.optional(),
    halfLifeHours: z.number().positive().optional(),
  })
  .refine(
    (payload) =>
      payload.hn !== undefined ||
      payload.reddit !== undefined ||
      payload.web !== undefined ||
      payload.webSearch !== undefined,
    { message: "at least one of hn, reddit, web, webSearch is required" },
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
  } catch {
    return false;
  }
}

const userSettingsCommonShape = {
  topN: z.number().int().min(1).max(50),
  halfLifeHours: z.number().positive().nullable(),
  hnEnabled: z.boolean(),
  hnConfig: hnConfigSchema.nullable(),
  redditEnabled: z.boolean(),
  redditConfig: redditConfigSchema.nullable(),
  webEnabled: z.boolean(),
  webConfig: webConfigSchema.nullable(),
  webSearchEnabled: z.boolean(),
  webSearchConfig: webSearchConfigInputSchema.nullable(),
  twitterEnabled: z.boolean(),
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
} as const;

interface SourceEnabledPayload {
  scheduleEnabled: boolean;
  hnEnabled: boolean;
  redditEnabled: boolean;
  webEnabled: boolean;
  webSearchEnabled: boolean;
  twitterEnabled: boolean;
}

const sourcesEnabledRefinement = (payload: SourceEnabledPayload): boolean =>
  !payload.scheduleEnabled ||
  payload.hnEnabled ||
  payload.redditEnabled ||
  payload.webEnabled ||
  payload.webSearchEnabled ||
  payload.twitterEnabled;

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
    webSearchEnabled: boolean;
    webSearchConfig: unknown;
    twitterEnabled: boolean;
    twitterConfig: unknown;
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
      enabled: payload.webSearchEnabled,
      config: payload.webSearchConfig,
      path: "webSearchConfig",
    },
    {
      enabled: payload.twitterEnabled,
      config: payload.twitterConfig,
      path: "twitterConfig",
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

  if (
    payload.webSearchEnabled &&
    payload.webSearchConfig !== null &&
    typeof payload.webSearchConfig === "object" &&
    "queries" in payload.webSearchConfig &&
    Array.isArray((payload.webSearchConfig as { queries: unknown }).queries) &&
    (payload.webSearchConfig as { queries: unknown[] }).queries.length === 0
  ) {
    ctx.addIssue({
      code: "custom",
      message: "webSearchConfig must include at least one query when enabled",
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
    webSearchEnabled: z.boolean().optional(),
    webSearchConfig: webSearchConfigInputSchema.nullable().optional(),
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
    webSearchEnabled:
      payload.webSearchEnabled ?? (payload.webSearchConfig ?? null) !== null,
    webSearchConfig: payload.webSearchConfig ?? null,
    twitterEnabled: payload.twitterEnabled ?? payload.twitterConfig !== null,
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
      webSearchEnabled: z.boolean(),
      webSearchConfig: webSearchConfigInputSchema.nullable(),
      twitterEnabled: z.boolean(),
      twitterConfig: twitterConfigInputSchema.nullable(),
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
