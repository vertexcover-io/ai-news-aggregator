export class CancelledError extends Error {
  readonly runId: string;

  constructor(runId: string) {
    super(`Run ${runId} was cancelled`);
    this.name = "CancelledError";
    this.runId = runId;
  }
}
