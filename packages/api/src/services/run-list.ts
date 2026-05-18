import type IORedis from "ioredis";
import type { RunState, RunSummary } from "@newsletter/shared";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";

export interface RunListDeps {
  redis: Pick<IORedis, "scanStream" | "get" | "mget">;
  archiveRepo: RunArchivesRepo;
}

async function scanRunKeys(
  redis: Pick<IORedis, "scanStream">,
): Promise<string[]> {
  const keys: string[] = [];
  const stream = redis.scanStream({ match: "run:*", count: 100 });
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (batch: string[]) => {
      for (const k of batch) keys.push(k);
    });
    stream.on("end", () => {
      resolve();
    });
    stream.on("error", reject);
  });
  return keys;
}

function parseRunState(raw: string | null): RunState | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as RunState;
  } catch {
    return null;
  }
}

export async function listRuns(
  limit: number,
  deps: RunListDeps,
): Promise<RunSummary[]> {
  const keys = await scanRunKeys(deps.redis);
  const values = keys.length > 0 ? await deps.redis.mget(...keys) : [];
  const redisSummaries: RunSummary[] = [];
  for (const raw of values) {
    const state = parseRunState(raw);
    if (!state) continue;
    redisSummaries.push({
      runId: state.id,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      status: state.status,
      itemCount: Array.isArray(state.rankedItems) ? state.rankedItems.length : 0,
      reviewed: false,
      isDryRun: false,
    });
  }

  const archives = await deps.archiveRepo.list(limit);
  const archiveSummaries: RunSummary[] = archives.map((row) => {
    const startedAt = row.completedAt.toISOString();
    return {
      runId: row.id,
      startedAt,
      completedAt: row.completedAt.toISOString(),
      status: row.status,
      itemCount: row.rankedItems.length,
      reviewed: row.reviewed,
      isDryRun: row.isDryRun,
    };
  });

  const byId = new Map<string, RunSummary>();
  for (const s of redisSummaries) byId.set(s.runId, s);
  for (const s of archiveSummaries) byId.set(s.runId, s);

  return Array.from(byId.values())
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, limit);
}
