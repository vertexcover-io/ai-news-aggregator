/**
 * A/B reviewer-intent eval harness.
 *
 * Runs the REAL shortlist + rank processors end-to-end on historical prod
 * pools, then scores the ranker's top-10 against reviewer-gold ground truth
 * (the reviewer's final shipped newsletter = must/nice; items the reviewer
 * removed from the LLM's original ranking = drop).
 *
 * Goal: measure whether a given (shortlist, ranking) prompt pair surfaces the
 * items the human reviewer actually wanted, so we can tune the prompts to
 * reduce the reviewer's editing burden.
 *
 * Hermetic: bodies come from the exported fixture content (no web fetch).
 * Cached: LLM calls are memoized on disk by (stage, model, promptHash, run).
 *
 *   tsx src/scripts/eval-ab-reviewer.ts \
 *     --shortlist-prompt <path> --rank-prompt <path> --label <name> [--runs all] \
 *     [--concurrency 4] [--no-cache] [--out <report.json>]
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import pLimit from "p-limit";

config({ path: resolve(import.meta.dirname, "../../../../.env") });

import type { Candidate, GroundTruthLabel, RankedItem } from "@newsletter/shared";
import type { SourceType } from "@newsletter/shared";
import { shortlistCandidates } from "@pipeline/processors/shortlist.js";
import { rankCandidates } from "@pipeline/processors/rank.js";
import {
  ndcgAtK,
  precisionAtK,
  mustIncludeRecall,
  rankOneIsMustInclude,
} from "@pipeline/eval/scoring.js";

const DATA_DIR = resolve(import.meta.dirname, "../../../../evals/ranking/ab-reviewer/data");
const CACHE_DIR = resolve(import.meta.dirname, "../../../../evals/ranking/ab-reviewer/cache");
const SHORTLIST_MODEL = process.env.AB_SHORTLIST_MODEL ?? "claude-haiku-4-5-20251001";
const RANK_MODEL = process.env.AB_RANK_MODEL ?? "claude-sonnet-4-5-20250929";
const SHORTLIST_SIZE = Number(process.env.AB_SHORTLIST_SIZE ?? "30");
const TOP_N = 12;
const HALF_LIFE_HOURS = 24;
const K = 10;

interface PoolItem {
  rawItemId: number;
  title: string;
  url: string;
  sourceType: string;
  author: string | null;
  publishedAt: string | null;
  engagement: unknown;
  content: string | null;
}
interface RunData {
  runId: string;
  date: string;
  now: string;
  finalIds: number[];
  snapshotIds: number[];
  pool: PoolItem[];
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function loadRuns(filter: string): RunData[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  const runs = files.map((f) => JSON.parse(readFileSync(resolve(DATA_DIR, f), "utf8")) as RunData);
  runs.sort((a, b) => a.date.localeCompare(b.date));
  if (filter === "all") return runs;
  const wanted = new Set(filter.split(",").map((s) => s.trim()));
  return runs.filter((r) => wanted.has(r.runId) || wanted.has(r.date));
}

function toCandidate(p: PoolItem): Candidate {
  return {
    id: p.rawItemId,
    title: p.title,
    url: p.url ?? "",
    sourceType: p.sourceType as SourceType,
    author: p.author,
    publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
    engagement: { points: 0, commentCount: 0 },
    content: p.content,
    comments: [],
  };
}

/**
 * Reviewer-gold labels:
 *   - must  = reviewer's final newsletter, top-K (the core picks)
 *   - nice  = reviewer's final newsletter beyond top-K (kept but lower)
 *   - drop  = items the LLM ranked that the reviewer removed (explicit rejects)
 */
function buildGroundTruth(run: RunData): GroundTruthLabel[] {
  const labels: GroundTruthLabel[] = [];
  const finalSet = new Set(run.finalIds);
  run.finalIds.forEach((id, idx) => {
    labels.push({ rawItemId: id, tier: idx < K ? "must" : "nice" });
  });
  for (const id of run.snapshotIds) {
    if (!finalSet.has(id)) labels.push({ rawItemId: id, tier: "drop" });
  }
  return labels;
}

function cacheGet(file: string): unknown | null {
  const p = resolve(CACHE_DIR, file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}
function cacheSet(file: string, value: unknown): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(resolve(CACHE_DIR, file), JSON.stringify(value));
}

interface RunScore {
  runId: string;
  date: string;
  ndcg: number;
  precision: number;
  recall: number;
  rank1Must: boolean;
  shortlistRecall: number; // fraction of must-items that survived the shortlist
  rankedTop: number[];
  mustIds: number[];
}

async function evalRun(
  run: RunData,
  shortlistPrompt: string,
  rankPrompt: string,
  useCache: boolean,
): Promise<RunScore> {
  const candidates = run.pool.map(toCandidate);
  const gt = buildGroundTruth(run);
  const mustIds = gt.filter((l) => l.tier === "must").map((l) => l.rawItemId);
  const slHash = sha(shortlistPrompt);
  const rkHash = sha(rankPrompt);

  // --- Stage 1: shortlist (cached on shortlist prompt + run) ---
  const slCacheFile = `shortlist-${SHORTLIST_MODEL}-${slHash}-n${SHORTLIST_SIZE}-${run.runId}.json`;
  let shortlistIds: number[];
  const slCached = useCache ? (cacheGet(slCacheFile) as { ids: number[] } | null) : null;
  if (slCached) {
    shortlistIds = slCached.ids;
  } else {
    const { shortlist } = await shortlistCandidates(candidates, {
      shortlistSize: SHORTLIST_SIZE,
      systemPrompt: shortlistPrompt,
      runId: run.runId,
      modelId: SHORTLIST_MODEL,
    });
    shortlistIds = shortlist.map((c) => c.id);
    cacheSet(slCacheFile, { ids: shortlistIds });
  }
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const shortlist = shortlistIds.map((id) => byId.get(id)).filter((c): c is Candidate => c !== undefined);
  const shortlistSet = new Set(shortlistIds);
  const shortlistRecall = mustIds.length === 0 ? 1 : mustIds.filter((id) => shortlistSet.has(id)).length / mustIds.length;

  // --- Stage 2: rank (cached on rank prompt + shortlist signature + run) ---
  const slSig = sha(shortlistIds.join(","));
  const rkCacheFile = `rank-${RANK_MODEL}-${rkHash}-${slSig}-${run.runId}.json`;
  let rankedTop: number[];
  const rkCached = useCache ? (cacheGet(rkCacheFile) as { ids: number[] } | null) : null;
  if (rkCached) {
    rankedTop = rkCached.ids;
  } else {
    const result = await rankCandidates(shortlist, {
      topN: TOP_N,
      systemPrompt: rankPrompt,
      modelId: RANK_MODEL,
      halfLifeHours: HALF_LIFE_HOURS,
      now: new Date(run.now),
      runId: run.runId,
      loadBodies: async (cands) => new Map(cands.map((c) => [c.id, c.content])),
    });
    rankedTop = result.rankedItems.map((r) => r.rawItemId);
    cacheSet(rkCacheFile, { ids: rankedTop });
  }

  const ranked: RankedItem[] = rankedTop.map((id) => ({ rawItemId: id }));
  return {
    runId: run.runId,
    date: run.date,
    ndcg: ndcgAtK(ranked, gt, K),
    precision: precisionAtK(ranked, gt, K),
    recall: mustIncludeRecall(ranked, gt, K),
    rank1Must: rankOneIsMustInclude(ranked, gt),
    shortlistRecall,
    rankedTop: rankedTop.slice(0, K),
    mustIds,
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "shortlist-prompt": { type: "string" },
      "rank-prompt": { type: "string" },
      label: { type: "string", default: "unlabeled" },
      runs: { type: "string", default: "all" },
      concurrency: { type: "string", default: "4" },
      "no-cache": { type: "boolean", default: false },
      out: { type: "string" },
    },
  });
  const shortlistPromptPath = values["shortlist-prompt"];
  const rankPromptPath = values["rank-prompt"];
  if (!shortlistPromptPath || !rankPromptPath) {
    throw new Error("--shortlist-prompt and --rank-prompt are required");
  }
  const shortlistPrompt = readFileSync(resolve(shortlistPromptPath), "utf8");
  const rankPrompt = readFileSync(resolve(rankPromptPath), "utf8");
  const useCache = !values["no-cache"];
  const runs = loadRuns(values.runs ?? "all");
  const limit = pLimit(Number(values.concurrency ?? "4"));

  process.stderr.write(
    `[ab-eval] label=${values.label} runs=${runs.length} shortlist=${SHORTLIST_MODEL} rank=${RANK_MODEL} cache=${useCache}\n`,
  );

  const results = await Promise.all(
    runs.map((run) =>
      limit(async () => {
        try {
          const s = await evalRun(run, shortlistPrompt, rankPrompt, useCache);
          process.stderr.write(
            `  ${s.date}  ndcg=${s.ndcg.toFixed(3)} prec=${s.precision.toFixed(3)} recall=${s.recall.toFixed(3)} slRecall=${s.shortlistRecall.toFixed(3)} r1must=${s.rank1Must}\n`,
          );
          return s;
        } catch (err) {
          process.stderr.write(`  ${run.date}  FAILED: ${err instanceof Error ? err.message : String(err)}\n`);
          return null;
        }
      }),
    ),
  );
  const scored = results.filter((r): r is RunScore => r !== null);

  const agg = {
    label: values.label,
    shortlistPrompt: shortlistPromptPath,
    rankPrompt: rankPromptPath,
    shortlistModel: SHORTLIST_MODEL,
    rankModel: RANK_MODEL,
    runs: scored.length,
    mean: {
      ndcg: mean(scored.map((s) => s.ndcg)),
      precision: mean(scored.map((s) => s.precision)),
      recall: mean(scored.map((s) => s.recall)),
      shortlistRecall: mean(scored.map((s) => s.shortlistRecall)),
      rank1MustRate: mean(scored.map((s) => (s.rank1Must ? 1 : 0))),
    },
    perRun: scored,
  };

  process.stderr.write(
    `\n[ab-eval] MEAN  nDCG@10=${agg.mean.ndcg.toFixed(4)}  P@10=${agg.mean.precision.toFixed(4)}  mustRecall@10=${agg.mean.recall.toFixed(4)}  shortlistRecall=${agg.mean.shortlistRecall.toFixed(4)}  rank1MustRate=${agg.mean.rank1MustRate.toFixed(4)}\n`,
  );

  const outPath =
    values.out ?? resolve(import.meta.dirname, `../../../../evals/ranking/ab-reviewer/reports/${values.label}.json`);
  writeFileSync(outPath, JSON.stringify(agg, null, 2));
  process.stderr.write(`[ab-eval] wrote ${outPath}\n`);
  // also emit aggregate JSON to stdout for programmatic capture
  process.stdout.write(JSON.stringify(agg.mean) + "\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
