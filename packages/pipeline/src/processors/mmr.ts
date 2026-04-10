import { createLogger } from "@newsletter/shared";
import type { RankedItemRef } from "@newsletter/shared";
import { cosineSimilarity } from "@pipeline/services/embeddings.js";

const logger = createLogger("processor:mmr");

export const MMR_LAMBDA = 0.7;
export const SOURCE_CAP = 3;

export interface MmrOptions {
  topN: number;
  titleEmbeds?: number[][]; // aligned to items[] order; empty → Jaccard mode (REQ-023, REQ-024)
  runId?: string;
}

export interface MmrItem {
  ref: RankedItemRef;
  title: string;
  sourceType: string;
}

export function mmrSelect(items: MmrItem[], options: MmrOptions): RankedItemRef[] {
  const started = Date.now();
  const { topN, titleEmbeds } = options;

  if (items.length === 0) {
    logger.info(
      { event: "mmr.end", runId: options.runId, inputCount: 0, outputCount: 0, durationMs: 0 },
      "mmr completed",
    );
    return [];
  }

  // Embeddings are valid only when provided and length-aligned to items
  const alignedEmbeds: number[][] | undefined =
    titleEmbeds?.length === items.length ? titleEmbeds : undefined;

  function similarity(i: number, j: number): number {
    if (alignedEmbeds) {
      return cosineSimilarity(alignedEmbeds[i], alignedEmbeds[j]);
    }
    return jaccardBigram(items[i].title, items[j].title);
  }

  const sourceCounts = new Map<string, number>();
  const selected: number[] = [];
  const remaining = new Set<number>(items.map((_, i) => i));

  while (selected.length < topN && remaining.size > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (const i of remaining) {
      const item = items[i];
      // Source cap enforcement (REQ-025)
      if ((sourceCounts.get(item.sourceType) ?? 0) >= SOURCE_CAP) continue;

      const fusionScore = item.ref.score;
      const maxSim =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((j) => similarity(i, j)));

      const mmrScore = MMR_LAMBDA * fusionScore - (1 - MMR_LAMBDA) * maxSim;

      // Tie-break by index order (EDGE-018)
      if (mmrScore > bestScore || (mmrScore === bestScore && (bestIdx === -1 || i < bestIdx))) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break; // all remaining hit source cap

    selected.push(bestIdx);
    remaining.delete(bestIdx);
    const srcType = items[bestIdx].sourceType;
    sourceCounts.set(srcType, (sourceCounts.get(srcType) ?? 0) + 1);
  }

  const result = selected.map((i) => items[i].ref);

  logger.info(
    {
      event: "mmr.end",
      runId: options.runId,
      inputCount: items.length,
      outputCount: result.length,
      durationMs: Date.now() - started,
    },
    "mmr completed",
  );

  return result;
}

// Bigram Jaccard similarity on unigram+bigram token sets (REQ-024)
export function jaccardBigram(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const bigrams = words.slice(0, -1).map((w, i) => `${w}_${words[i + 1] ?? ""}`);
  return [...words, ...bigrams];
}
