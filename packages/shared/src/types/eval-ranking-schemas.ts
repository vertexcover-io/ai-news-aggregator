import { z } from "zod";

export const TierSchema = z.enum(["must", "nice", "drop"]);
export const FixtureSourceSchema = z.enum(["run", "manual", "calendar"]);
export const EnrichmentStatusSchema = z.enum(["ok", "failed", "skipped"]);

export const RankedItemSchema = z.object({
  rawItemId: z.number().int(),
});

export const GroundTruthLabelSchema = z.object({
  rawItemId: z.number().int(),
  tier: TierSchema,
});

const EnrichedLinkContentSchema = z.looseObject({
  url: z.string(),
  fetchedAt: z.string(),
  status: z.enum(["ok", "skipped", "failed"]),
});

const RawItemCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  content: z.string(),
  publishedAt: z.string(),
});

export const FixtureItemSchema = z.object({
  rawItemId: z.number().int(),
  title: z.string(),
  url: z.string(),
  sourceType: z.string(),
  publishedAt: z.string().nullable(),
  content: z.string().nullable(),
  enrichedLink: EnrichedLinkContentSchema.nullable(),
  enrichmentStatus: EnrichmentStatusSchema,
  comments: z.array(RawItemCommentSchema),
  engagement: z
    .object({ points: z.number(), commentCount: z.number() })
    .nullable(),
});

export const FixtureDedupClusterSchema = z.object({
  representativeId: z.number().int(),
  duplicateIds: z.array(z.number().int()),
});

export const OriginalRankerOutputEntrySchema = z.object({
  rawItemId: z.number().int(),
  score: z.number(),
  rationale: z.string(),
});

export const FixtureSchema = z.object({
  fixtureId: z.string(),
  source: FixtureSourceSchema,
  date: z.string().nullable(),
  runId: z.string().nullable(),
  model: z.string().min(1),
  exportedAt: z.string(),
  pool: z.array(FixtureItemSchema),
  dedupClusters: z.array(FixtureDedupClusterSchema),
  originalRankerOutput: z.array(OriginalRankerOutputEntrySchema).nullable(),
});

export const GroundTruthSchema = z.object({
  fixtureId: z.string(),
  gradedBy: z.array(z.string()),
  gradedAt: z.string(),
  labels: z.array(GroundTruthLabelSchema),
});

export const EvalRunRequestSchema = z.object({
  mode: z.enum(["scored", "ab"]),
  fixtureId: z.string().optional(),
  date: z.string().optional(),
  draftPrompt: z.string(),
  savedPrompt: z.string().optional(),
  windowSize: z.number().int().optional(),
  bypassCache: z.boolean().optional(),
});

export const PerItemDiffRowSchema = z.object({
  rawItemId: z.number().int(),
  rankerRank: z.number().int().nullable(),
  groundTruthTier: TierSchema.nullable(),
});

export const EvalScoreSchema = z.object({
  fixtureId: z.string(),
  ndcgAt10: z.number(),
  precisionAt10: z.number(),
  mustIncludeRecall: z.number(),
  rankOneIsMustInclude: z.boolean(),
  perItemDiff: z.array(PerItemDiffRowSchema),
  ranAt: z.string(),
  promptHash: z.string(),
  model: z.string(),
});

export const AbRankingSchema = z.object({
  savedRanking: z.array(RankedItemSchema),
  draftRanking: z.array(RankedItemSchema),
});

export const PerFixtureCostSchema = z.object({
  promptHash: z.string(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  usd: z.number(),
  cacheHit: z.boolean(),
});

export const PerFixtureResultSchema = z.object({
  fixtureId: z.string(),
  scored: EvalScoreSchema.optional(),
  ab: AbRankingSchema.optional(),
  cost: PerFixtureCostSchema,
});

export const SourcingReportRowSchema = z.object({
  sourceType: z.string(),
  mustIncludeCount: z.number().int(),
  niceCount: z.number().int(),
  dropCount: z.number().int(),
});

export const DeltaVsPreviousSchema = z.object({
  fixtureId: z.string(),
  previousNdcg: z.number(),
  currentNdcg: z.number(),
  delta: z.number(),
});

export const EvalAggregateSchema = z.object({
  meanNdcgAt10: z.number(),
  meanPrecisionAt10: z.number(),
  sourcingReport: z.array(SourcingReportRowSchema),
  deltaVsPrevious: z.array(DeltaVsPreviousSchema),
});

export const EvalResultSchema = z.object({
  mode: z.enum(["scored", "ab"]),
  perFixture: z.array(PerFixtureResultSchema),
  aggregate: EvalAggregateSchema.optional(),
  totalCost: z.object({
    usd: z.number(),
    totalTokensIn: z.number(),
    totalTokensOut: z.number(),
  }),
});

export type FixtureInferred = z.infer<typeof FixtureSchema>;
export type FixtureItemInferred = z.infer<typeof FixtureItemSchema>;
