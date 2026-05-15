import { config } from "dotenv";
import postgres from "postgres";
import { resolve } from "node:path";
import { z } from "zod";
import type { Candidate, RawItemComment } from "@newsletter/shared";
import { rankCandidates } from "@pipeline/processors/rank.js";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

const DEFAULT_RUN_ID = "995bf202-c76e-4bc9-80a3-21fb2df66ce4";
const TOP_N = 10;
const NOW = new Date("2026-05-15T07:33:45.693Z");
const BODY_TOKEN_BUDGET = 350;
const COMMENTS_PER_ITEM = 2;
const COMMENT_TOKEN_BUDGET = 120;

const IDEAL_ORDER = [
  24041,
  24089,
  24073,
  24043,
  24082,
  24124,
  24052,
  24079,
  24120,
  24072,
] as const;

const sourceTypeSchema = z.enum([
  "hn",
  "reddit",
  "twitter",
  "rss",
  "github",
  "blog",
  "newsletter",
]);

const commentSchema = z.object({
  id: z.string(),
  author: z.string(),
  content: z.string(),
  publishedAt: z.string(),
});

const rowSchema = z.object({
  id: z.number(),
  title: z.string(),
  url: z.string(),
  source_type: sourceTypeSchema,
  author: z.string().nullable(),
  published_at: z.string().nullable(),
  points: z.number(),
  comment_count: z.number(),
  body: z.string().nullable(),
  comments: z.array(commentSchema),
});

type CandidateRow = z.infer<typeof rowSchema>;

type RankingCheck = {
  readonly passed: boolean;
  readonly failures: ReadonlyArray<string>;
  readonly rankedIds: ReadonlyArray<number>;
  readonly idealHits: number;
  readonly inversionCount: number;
};

function toCandidate(row: CandidateRow): Candidate {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    sourceType: row.source_type,
    author: row.author,
    publishedAt:
      row.published_at === null ? null : new Date(row.published_at),
    engagement: {
      points: row.points,
      commentCount: row.comment_count,
    },
    content: row.body,
    comments: row.comments,
  };
}

function loadInlineBodies(
  candidates: Candidate[],
): Promise<Map<number, string | null>> {
  return Promise.resolve(
    new Map(candidates.map((candidate) => [candidate.id, candidate.content])),
  );
}

function countInversions(rankedIds: ReadonlyArray<number>): number {
  const actualRank = new Map(rankedIds.map((id, index) => [id, index]));
  return IDEAL_ORDER.reduce((count, earlierId, earlierIndex) => {
    const earlierRank = actualRank.get(earlierId);
    if (earlierRank === undefined) return count;
    const laterViolations = IDEAL_ORDER.slice(earlierIndex + 1).filter(
      (laterId) => {
        const laterRank = actualRank.get(laterId);
        return laterRank !== undefined && laterRank < earlierRank;
      },
    ).length;
    return count + laterViolations;
  }, 0);
}

function evaluateRankedIds(rankedIds: ReadonlyArray<number>): RankingCheck {
  const top10 = rankedIds.slice(0, TOP_N);
  const top3 = top10.slice(0, 3);
  const failures: string[] = [];
  const idealSet = new Set<number>(IDEAL_ORDER);
  const idealHits = top10.filter((id) => idealSet.has(id)).length;
  const inversionCount = countInversions(top10);

  for (const requiredTop3 of [24041, 24089, 24073]) {
    if (!top3.includes(requiredTop3)) {
      failures.push(`expected ${requiredTop3} in top 3`);
    }
  }

  if (idealHits < 8) {
    failures.push(`expected at least 8 ideal ids in top 10, got ${idealHits}`);
  }

  for (const oldOverranked of [24061, 24033, 24074]) {
    if (top10.includes(oldOverranked)) {
      failures.push(`expected old overranked item ${oldOverranked} outside top 10`);
    }
  }

  const frontierRank = top10.indexOf(24072);
  if (frontierRank !== -1 && frontierRank < 7) {
    failures.push("expected frontier-access strategy story 24072 at rank 8 or lower");
  }

  if (inversionCount > 8) {
    failures.push(`expected at most 8 ideal-order inversions, got ${inversionCount}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    rankedIds,
    idealHits,
    inversionCount,
  };
}

async function loadRunCandidates(runId: string): Promise<ReadonlyArray<Candidate>> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const rows = await sql`
      with archive as (
        select started_at, completed_at, source_types
        from run_archives
        where id = ${runId}
      )
      select
        ri.id,
        ri.title,
        ri.url,
        ri.source_type,
        ri.author,
        ri.published_at::text as published_at,
        coalesce((ri.engagement->>'points')::int, 0) as points,
        coalesce((ri.engagement->>'commentCount')::int, 0) as comment_count,
        nullif(
          concat_ws(
            E'\n\n',
            nullif(ri.content, ''),
            nullif(ri.metadata->'enrichedLink'->>'title', ''),
            nullif(ri.metadata->'enrichedLink'->>'description', ''),
            nullif(ri.metadata->'enrichedLink'->>'markdown', '')
          ),
          ''
        ) as body,
        coalesce(ri.metadata->'comments', '[]'::jsonb) as comments
      from raw_items ri, archive a
      where ri.collected_at between a.started_at and a.completed_at
        and (
          a.source_types is null
          or ri.source_type in (select jsonb_array_elements_text(a.source_types))
        )
      order by ri.id asc
    `;

    return rows.map((row) => toCandidate(rowSchema.parse(row)));
  } finally {
    await sql.end();
  }
}

async function main(): Promise<number> {
  if (process.env.RUN_LIVE_RANK_EVAL !== "1") {
    console.log(
      "Skipping run rank eval. Set RUN_LIVE_RANK_EVAL=1 to spend one Anthropic ranking call.",
    );
    return 0;
  }

  const runId = process.env.RANK_EVAL_RUN_ID ?? DEFAULT_RUN_ID;
  const candidates = await loadRunCandidates(runId);
  const result = await rankCandidates([...candidates], {
    topN: TOP_N,
    now: NOW,
    loadBodies: loadInlineBodies,
    bodyTokenBudget: BODY_TOKEN_BUDGET,
    commentsPerItem: COMMENTS_PER_ITEM,
    commentTokenBudget: COMMENT_TOKEN_BUDGET,
    runId: `eval:${runId}`,
  });

  const rankedIds = result.rankedItems.map((item) => item.rawItemId);
  const check = evaluateRankedIds(rankedIds);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  console.log(`Rank eval candidates: ${candidates.length}`);
  console.log(`Digest: ${result.digestHeadline}`);
  console.log("Ranked output:");
  for (const [index, item] of result.rankedItems.entries()) {
    const candidate = candidatesById.get(item.rawItemId);
    console.log(
      `${index + 1}. #${item.rawItemId} score=${item.score.toFixed(2)} ${candidate?.title ?? item.title}`,
    );
    console.log(`   ${item.rationale}`);
  }
  console.log(
    `Ideal hits in top 10: ${check.idealHits}; ideal-order inversions: ${check.inversionCount}`,
  );

  if (check.passed) {
    console.log("Run rank eval passed.");
    return 0;
  }

  console.error("Run rank eval failed:");
  for (const failure of check.failures) {
    console.error(`- ${failure}`);
  }
  return 1;
}

process.exitCode = await main();
