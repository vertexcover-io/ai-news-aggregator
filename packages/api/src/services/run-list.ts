import type IORedis from "ioredis";
import type { RunState, RunSummary } from "@newsletter/shared";
import { formatDateInTimezone, parseRunCostBreakdown } from "@newsletter/shared";
import {
  isTenantContext,
  type TenantScope,
} from "@newsletter/shared/types/tenant-context";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";
import { TERMINAL_STATUSES } from "@api/services/run-observability.js";

export interface RunListDeps {
  redis: Pick<IORedis, "scanStream" | "get" | "mget">;
  archiveRepo: RunArchivesRepo;
  timezone?: string;
  /**
   * REQ-013: the SCAN over `run:*` sees every tenant's live state, so each
   * entry is fenced to the requester's tenant here (the archiveRepo side is
   * already fenced by its scoped factory). Legacy states without a tenantId
   * stay listed (grandfathered — written before the stamp existed).
   */
  requesterScope?: TenantScope;
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
  const [keys, archives] = await Promise.all([
    scanRunKeys(deps.redis),
    deps.archiveRepo.list(limit),
  ]);
  const archiveIds = new Set(archives.map((row) => row.id));

  const values = keys.length > 0 ? await deps.redis.mget(...keys) : [];
  const redisSummaries: RunSummary[] = [];
  for (const raw of values) {
    const state = parseRunState(raw);
    if (!state) continue;
    // REQ-013: another tenant's live run reads as absent.
    if (
      isTenantContext(deps.requesterScope) &&
      typeof state.tenantId === "string" &&
      state.tenantId !== deps.requesterScope.tenantId
    ) {
      continue;
    }
    // Skip terminal Redis entries that have no matching archive row: these are
    // ghosts (the empty-shortlist class — terminal in Redis but the archive
    // upsert was never reached). The archive row is the source of truth for
    // terminal runs; Redis only contributes live-progress entries.
    if (TERMINAL_STATUSES.has(state.status) && !archiveIds.has(state.id)) {
      continue;
    }
    redisSummaries.push({
      runId: state.id,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      status: state.status,
      itemCount: Array.isArray(state.rankedItems) ? state.rankedItems.length : 0,
      reviewed: false,
      isDryRun: false,
      costBreakdown: null,
      linkedinPostedAt: null,
      twitterPostedAt: null,
      linkedinPermalink: null,
      twitterPermalink: null,
      draftSavedAt: null,
    });
  }

  const archiveSummaries: RunSummary[] = archives.map((row) => {
    const startedAt = row.completedAt.toISOString();
    // Validate the JSONB shape at the boundary. Rows written by the prior
    // (reverted) PR #162 implementation use an incompatible shape — surface
    // them as `null` rather than letting the malformed object crash the UI.
    const costBreakdown = parseRunCostBreakdown(row.costBreakdown);
    return {
      runId: row.id,
      startedAt,
      completedAt: row.completedAt.toISOString(),
      status: row.status,
      itemCount: row.rankedItems.length,
      reviewed: row.reviewed,
      isDryRun: row.isDryRun,
      costBreakdown,
      issueDate: formatDateInTimezone(
        row.publishedAt ?? row.completedAt,
        deps.timezone,
      ),
      linkedinPostedAt: row.linkedinPostedAt?.toISOString() ?? null,
      twitterPostedAt: row.twitterPostedAt?.toISOString() ?? null,
      linkedinPermalink: row.socialMetadata?.linkedinPermalink ?? null,
      twitterPermalink: row.socialMetadata?.twitterPermalink ?? null,
      draftSavedAt: row.draftSavedAt?.toISOString() ?? null,
    };
  });

  const byId = new Map<string, RunSummary>();
  for (const s of redisSummaries) byId.set(s.runId, s);
  for (const s of archiveSummaries) byId.set(s.runId, s);

  return Array.from(byId.values())
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, limit);
}
