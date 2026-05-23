import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CACHE_DIR } from "@newsletter/shared/constants/eval-ranking";

export interface ScoreHistoryEntry {
  fixtureId: string;
  ndcgAt10: number;
  ranAt: string;
  promptHash: string;
}

export type ScoreHistory = Record<string, ScoreHistoryEntry>;

const DEFAULT_PATH = join(CACHE_DIR, "scores.json");

export async function readScoreHistory(
  path: string = DEFAULT_PATH,
): Promise<ScoreHistory> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return {};
    return parsed as ScoreHistory;
  } catch {
    return {};
  }
}

export async function recordScore(
  entry: ScoreHistoryEntry,
  path: string = DEFAULT_PATH,
): Promise<void> {
  const existing = await readScoreHistory(path);
  existing[entry.fixtureId] = entry;
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(existing, null, 2), "utf8");
  await rename(tmpPath, path);
}
