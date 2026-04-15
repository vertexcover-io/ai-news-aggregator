import type IORedis from "ioredis";
import { runKey, runCancelChannel } from "@newsletter/shared";
import type { RunState, RunStatus } from "@newsletter/shared";
import type { RunArchivesRepo } from "@api/repositories/run-archives.js";

export class CancelNotFoundError extends Error {
  constructor(runId: string) {
    super(`run not found: ${runId}`);
    this.name = "CancelNotFoundError";
  }
}

export class CancelConflictError extends Error {
  readonly currentStatus: RunStatus;
  constructor(currentStatus: RunStatus) {
    super("run is not cancellable");
    this.name = "CancelConflictError";
    this.currentStatus = currentStatus;
  }
}

export interface CancelRunDeps {
  redis: IORedis;
  publisher: IORedis;
  archiveRepo: RunArchivesRepo;
}

export async function cancelRun(
  runId: string,
  deps: CancelRunDeps,
): Promise<RunState> {
  const raw = await deps.redis.get(runKey(runId));

  if (raw === null) {
    // Not in Redis — check if it exists in the archive (terminal state)
    const archive = await deps.archiveRepo.findById(runId);
    if (archive === null) {
      throw new CancelNotFoundError(runId);
    }
    // Archive exists → run is terminal (completed/failed/cancelled)
    throw new CancelConflictError(archive.status);
  }

  const state = JSON.parse(raw) as RunState;

  if (state.status === "cancelling") {
    // Already cancelling — idempotent, no re-publish
    return state;
  }

  if (
    state.status === "completed" ||
    state.status === "failed" ||
    state.status === "cancelled"
  ) {
    throw new CancelConflictError(state.status);
  }

  // status === "running" — transition to cancelling
  const updated: RunState = {
    ...state,
    status: "cancelling",
    updatedAt: new Date().toISOString(),
  };

  await deps.redis.set(runKey(runId), JSON.stringify(updated));
  await deps.publisher.publish(runCancelChannel(runId), "");

  return updated;
}
