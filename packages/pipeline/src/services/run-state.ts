/**
 * Typed wrapper around Redis for reading/merging/writing `run:{runId}` keys.
 *
 * Why read-modify-write instead of WATCH/MULTI: MVP has a single collection
 * worker and a single run-process worker, and each run has independent keys.
 * Contention on the same key is limited to a collector child and the parent
 * job running simultaneously, which doesn't happen in the fan-out/fan-in flow
 * (parent starts only after children finish). Simple read-modify-write is
 * sufficient.
 */
import type IORedis from "ioredis";
import {
  RUN_STATE_TTL_SECONDS,
  runKey,
} from "@newsletter/shared";
import type {
  RunStage,
  RunState,
  RunStatus,
  SourceRunState,
} from "@newsletter/shared";

export type RunSourceType = keyof RunState["sources"];

export { RUN_STATE_TTL_SECONDS };

const keyOf = runKey;

type RedisLike = Pick<IORedis, "get" | "set">;

export interface RunStateService {
  get(runId: string): Promise<RunState | null>;
  set(state: RunState): Promise<void>;
  update(
    runId: string,
    mutate: (prev: RunState) => RunState,
  ): Promise<RunState | null>;
  updateSource(
    runId: string,
    sourceType: RunSourceType,
    patch: Partial<SourceRunState>,
  ): Promise<void>;
  setStage(runId: string, stage: RunStage, status?: RunStatus): Promise<void>;
}

export function createRunStateService(redis: RedisLike): RunStateService {
  const getState = async (runId: string): Promise<RunState | null> => {
    const raw = await redis.get(keyOf(runId));
    if (raw === null) return null;
    return JSON.parse(raw) as RunState;
  };

  const setState = async (state: RunState): Promise<void> => {
    const now = new Date().toISOString();
    const payload: RunState = { ...state, updatedAt: now };
    await redis.set(
      keyOf(state.id),
      JSON.stringify(payload),
      "EX",
      RUN_STATE_TTL_SECONDS,
    );
  };

  const updateState = async (
    runId: string,
    mutate: (prev: RunState) => RunState,
  ): Promise<RunState | null> => {
    const prev = await getState(runId);
    if (!prev) return null;
    const next = mutate(prev);
    await setState(next);
    return next;
  };

  return {
    get: getState,
    set: setState,
    update: updateState,
    async updateSource(runId, sourceType, patch) {
      await updateState(runId, (prev) => {
        const current: SourceRunState = prev.sources[sourceType] ?? {
          status: "pending",
          itemsFetched: 0,
          errors: [],
        };
        return {
          ...prev,
          sources: {
            ...prev.sources,
            [sourceType]: { ...current, ...patch },
          },
        };
      });
    },
    async setStage(runId, stage, status) {
      await updateState(runId, (prev) => ({
        ...prev,
        stage,
        status: status ?? prev.status,
      }));
    },
  };
}
