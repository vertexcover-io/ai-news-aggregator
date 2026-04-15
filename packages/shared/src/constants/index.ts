export const RUN_STATE_TTL_SECONDS = 3600;
export const runKey = (runId: string): string => `run:${runId}`;
export const runCancelChannel = (runId: string): string => `run:cancel:${runId}`;
