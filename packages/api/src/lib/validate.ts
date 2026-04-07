import { z } from "zod";

const hnConfigSchema = z.object({
  keywords: z.array(z.string()).optional(),
  pointsThreshold: z.number().int().min(0).optional(),
  sinceDays: z.number().int().min(1).max(30),
});

const redditConfigSchema = z.object({
  subreddits: z.array(z.string().min(1)).min(1),
  sort: z.enum(["hot", "new", "top"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sinceDays: z.number().int().min(1).max(30),
});

export const runSubmitSchema = z
  .object({
    topN: z.number().int().min(1).max(50),
    hn: hnConfigSchema.optional(),
    reddit: redditConfigSchema.optional(),
  })
  .refine(
    (payload) => payload.hn !== undefined || payload.reddit !== undefined,
    { message: "at least one of hn, reddit is required" },
  );

export type RunSubmitBody = z.infer<typeof runSubmitSchema>;
