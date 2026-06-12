import { z } from "zod";

export const hnSourceConfigSchema = z
  .object({
    keywords: z.array(z.string()).optional(),
    pointsThreshold: z.number().int().min(0).optional(),
    sinceDays: z.number().int().min(1).max(30),
    feeds: z.array(z.enum(["newest", "best"])).min(1).optional(),
    count: z.number().int().min(1).max(1000).optional(),
    commentsPerItem: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const redditSourceConfigSchema = z
  .object({
    subreddit: z.string().min(1),
    sort: z.enum(["hot", "new", "top"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    sinceDays: z.number().int().min(1).max(30),
  })
  .strict();

export const webSourceConfigSchema = z
  .object({
    name: z.string().min(1),
    listingUrl: z.url(),
  })
  .strict();

const TWITTER_HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export const twitterSourceConfigSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("list"),
      listId: z.string().regex(/^\d+$/, { message: "listId must be a digit string" }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("user"),
      handle: z.string().regex(TWITTER_HANDLE_RE, {
        message: "handle must be 1-15 chars of letters, digits, or underscore (no @)",
      }),
      userId: z.string().regex(/^\d+$/, { message: "userId must be a digit string" }),
    })
    .strict(),
]);

export const webSearchSourceConfigSchema = z
  .object({
    query: z.string().trim().min(1).max(400),
    sinceDays: z.number().int().min(1).max(30),
    maxItems: z.number().int().min(1).max(20),
  })
  .strict();

export const sourceConfigSchemaByType = {
  hn: hnSourceConfigSchema,
  reddit: redditSourceConfigSchema,
  web: webSourceConfigSchema,
  twitter: twitterSourceConfigSchema,
  web_search: webSearchSourceConfigSchema,
} as const;

export const sourceCreateSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hn"), config: hnSourceConfigSchema, enabled: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("reddit"), config: redditSourceConfigSchema, enabled: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("web"), config: webSourceConfigSchema, enabled: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("twitter"), config: twitterSourceConfigSchema, enabled: z.boolean().optional() }).strict(),
  z.object({ type: z.literal("web_search"), config: webSearchSourceConfigSchema, enabled: z.boolean().optional() }).strict(),
]);

export const sourcePatchSchema = z
  .object({
    config: z.unknown().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((body) => body.config !== undefined || body.enabled !== undefined, {
    message: "at least one of config, enabled is required",
  });

export const discoverBodySchema = z
  .object({ topic: z.string().trim().min(2).max(200) })
  .strict();
