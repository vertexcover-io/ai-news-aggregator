import { createLogger } from "@newsletter/shared";
import type { Candidate } from "@newsletter/shared";
import {
  embedBatch as defaultEmbedBatch,
  cosineSimilarity,
} from "@pipeline/services/embeddings.js";

const logger = createLogger("processor:semantic-dedup");

export const SIMILARITY_THRESHOLD = 0.85;

export const AUTHORITY_RANK: Record<string, number> = {
  blog: 3,
  reddit: 2,
  hn: 1,
};

export interface SemanticDedupOptions {
  threshold?: number;
  runId?: string;
  embedBatch?: typeof defaultEmbedBatch;
}

export interface SemanticDedupResult {
  candidates: Candidate[];
  titleEmbeds: number[][];
}

function makeUnionFind(n: number): {
  find: (x: number) => number;
  union: (x: number, y: number) => void;
} {
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    const px = parent[x];
    if (px === x) return x;
    const root = find(px);
    parent[x] = root;
    return root;
  }

  function union(x: number, y: number): void {
    parent[find(x)] = find(y);
  }

  return { find, union };
}

export async function semanticDedupCandidates(
  candidates: readonly Candidate[],
  options: SemanticDedupOptions = {},
): Promise<SemanticDedupResult> {
  const started = Date.now();
  const threshold = options.threshold ?? SIMILARITY_THRESHOLD;
  const embed = options.embedBatch ?? defaultEmbedBatch;

  if (candidates.length === 0) {
    logger.info(
      {
        event: "semantic-dedup.end",
        runId: options.runId,
        inputCount: 0,
        outputCount: 0,
        durationMs: 0,
      },
      "semantic dedup completed",
    );
    return { candidates: [], titleEmbeds: [] };
  }

  // Single batch call for all titles — REQ-003
  const allEmbeds = await embed(
    candidates.map((c) => c.title),
    { inputType: "document" },
  );

  const { find, union } = makeUnionFind(candidates.length);

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const sim = cosineSimilarity(allEmbeds[i], allEmbeds[j]);
      if (sim > threshold) {
        union(i, j);
      }
    }
  }

  // Group by cluster root
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    const existing = clusters.get(root);
    if (existing !== undefined) {
      existing.push(i);
    } else {
      clusters.set(root, [i]);
    }
  }

  const outputCandidates: Candidate[] = [];
  const outputEmbeds: number[][] = [];

  for (const indices of clusters.values()) {
    if (indices.length === 1) {
      // clusters always contain at least one element — safe direct access
      const idx = indices[0];
      outputCandidates.push(candidates[idx]);
      outputEmbeds.push(allEmbeds[idx]);
      continue;
    }

    // Sum engagement across all cluster members — REQ-004
    let mergedPoints = 0;
    let mergedCommentCount = 0;
    for (const i of indices) {
      mergedPoints += candidates[i].engagement.points;
      mergedCommentCount += candidates[i].engagement.commentCount;
    }

    // Select representative: most comments, tie-break by longest content — REQ-006
    let repIdx = indices[0];
    for (const i of indices) {
      const cur = candidates[i];
      const best = candidates[repIdx];
      if (cur.comments.length !== best.comments.length) {
        if (cur.comments.length > best.comments.length) repIdx = i;
      } else if ((cur.content?.length ?? 0) > (best.content?.length ?? 0)) {
        repIdx = i;
      }
    }

    // Pick highest-authority sourceType across cluster — REQ-005/REQ-007
    const repCandidate = candidates[repIdx];
    let highestAuthoritySourceType = repCandidate.sourceType;
    for (const i of indices) {
      const c = candidates[i];
      const rank = AUTHORITY_RANK[c.sourceType] ?? 0;
      const bestRank = AUTHORITY_RANK[highestAuthoritySourceType] ?? 0;
      if (rank > bestRank) {
        highestAuthoritySourceType = c.sourceType;
      }
    }

    const repEmbed = allEmbeds[repIdx];

    const rep: Candidate = {
      ...repCandidate,
      sourceType: highestAuthoritySourceType,
      engagement: { points: mergedPoints, commentCount: mergedCommentCount },
    };

    outputCandidates.push(rep);
    outputEmbeds.push(repEmbed);
  }

  logger.info(
    {
      event: "semantic-dedup.end",
      runId: options.runId,
      inputCount: candidates.length,
      outputCount: outputCandidates.length,
      durationMs: Date.now() - started,
    },
    "semantic dedup completed",
  );

  return { candidates: outputCandidates, titleEmbeds: outputEmbeds };
}
