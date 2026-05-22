import type {
  EvalRun,
  EvalRunRequest,
  EvalRunStatus,
  EvalRunSummary,
  Fixture,
  FixtureSource,
  GradingStatus,
  GroundTruth,
} from "@newsletter/shared/types/eval-ranking";
import { apiFetchAdmin } from "./client";

export interface FixtureSummary {
  fixtureId: string;
  source: FixtureSource;
  date: string | null;
  model: string;
  exportedAt: string;
  itemCount: number;
  gradingStatus: GradingStatus;
}

export interface EvalSseEvent {
  event: string;
  data: unknown;
}

export interface EvalRunStream {
  progress: AsyncIterable<EvalSseEvent>;
  abort: () => void;
}

export class EvalApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "EvalApiError";
    this.status = status;
    this.body = body;
  }
}

async function readErrorBody(
  res: Response,
): Promise<{ message: string; body: unknown }> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const message =
    (body as { error?: string } | undefined)?.error ??
    `request failed (${String(res.status)})`;
  return { message, body };
}

export interface EvalFixtureResponse {
  fixture: Fixture;
  groundTruth: GroundTruth | null;
}

export async function getEvalFixture(id: string): Promise<EvalFixtureResponse> {
  const res = await apiFetchAdmin(
    `/api/admin/eval/fixtures/${encodeURIComponent(id)}`,
  );
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  return (await res.json()) as EvalFixtureResponse;
}

export async function saveGroundTruth(
  fixtureId: string,
  gt: GroundTruth,
): Promise<GroundTruth> {
  const res = await apiFetchAdmin(
    `/api/admin/eval/groundtruth/${encodeURIComponent(fixtureId)}`,
    {
      method: "POST",
      body: JSON.stringify(gt),
    },
  );
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  const payload = (await res.json()) as { groundTruth: GroundTruth };
  return payload.groundTruth;
}

export async function saveGroundTruthToRepo(
  fixtureId: string,
  gt: GroundTruth,
): Promise<{ ok: true }> {
  const res = await apiFetchAdmin(
    `/api/admin/eval/groundtruth/${encodeURIComponent(fixtureId)}/save-to-repo`,
    {
      method: "POST",
      body: JSON.stringify(gt),
    },
  );
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  return (await res.json()) as { ok: true };
}

export interface CreateManualFixtureResponse {
  fixtureId: string;
  itemCount: number;
}

export async function createManualFixture(
  urls: string[],
  name?: string,
): Promise<CreateManualFixtureResponse> {
  const body: { urls: string[]; name?: string } = { urls };
  if (name && name.trim().length > 0) body.name = name.trim();
  const res = await apiFetchAdmin("/api/admin/eval/fixtures", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const { message, body: errBody } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, errBody);
  }
  const data = (await res.json()) as {
    fixtureId: string;
    itemCount: number;
  };
  return { fixtureId: data.fixtureId, itemCount: data.itemCount };
}

export async function listEvalFixtures(): Promise<{
  fixtures: FixtureSummary[];
}> {
  const res = await apiFetchAdmin("/api/admin/eval/fixtures");
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  return (await res.json()) as { fixtures: FixtureSummary[] };
}

export interface ListEvalRunsParams {
  page?: number;
  perPage?: number;
  mode?: "scored" | "ab";
  status?: EvalRunStatus;
  fixtureId?: string;
}

export interface ListEvalRunsResponse {
  runs: EvalRunSummary[];
  total: number;
  page: number;
  perPage: number;
}

export async function listEvalRuns(
  params: ListEvalRunsParams = {},
): Promise<ListEvalRunsResponse> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set("page", String(params.page));
  if (params.perPage !== undefined) qs.set("perPage", String(params.perPage));
  if (params.mode !== undefined) qs.set("mode", params.mode);
  if (params.status !== undefined) qs.set("status", params.status);
  if (params.fixtureId !== undefined) qs.set("fixtureId", params.fixtureId);
  const query = qs.toString();
  const path = query.length > 0
    ? `/api/admin/eval/runs?${query}`
    : "/api/admin/eval/runs";
  const res = await apiFetchAdmin(path);
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  return (await res.json()) as ListEvalRunsResponse;
}

export async function getEvalRun(id: string): Promise<EvalRun> {
  const res = await apiFetchAdmin(
    `/api/admin/eval/runs/${encodeURIComponent(id)}`,
  );
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  const payload = (await res.json()) as { run: EvalRun };
  return payload.run;
}

export async function saveDraftPrompt(
  prompt: string,
): Promise<{ ok: true }> {
  const res = await apiFetchAdmin("/api/admin/eval/save-prompt", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const { message, body } = await readErrorBody(res);
    throw new EvalApiError(message, res.status, body);
  }
  return { ok: true };
}

interface QueueNode<T> {
  value: T;
  next: QueueNode<T> | null;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private head: QueueNode<T> | null = null;
  private tail: QueueNode<T> | null = null;
  private waiter: ((v: IteratorResult<T>) => void) | null = null;
  private done = false;
  private error: Error | null = null;

  push(value: T): void {
    if (this.done) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value, done: false });
      return;
    }
    const node: QueueNode<T> = { value, next: null };
    if (this.tail) this.tail.next = node;
    else this.head = node;
    this.tail = node;
  }

  close(error?: Error): void {
    if (this.done) return;
    this.done = true;
    if (error) this.error = error;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w({ value: undefined as unknown as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.head) {
          const node = this.head;
          this.head = node.next;
          if (this.head === null) this.tail = null;
          return Promise.resolve({ value: node.value, done: false });
        }
        if (this.done) {
          if (this.error) return Promise.reject(this.error);
          return Promise.resolve({
            value: undefined as unknown as T,
            done: true,
          });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiter = resolve;
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.done = true;
        return Promise.resolve({
          value: undefined as unknown as T,
          done: true,
        });
      },
    };
  }
}

export function runEval(body: EvalRunRequest): EvalRunStream {
  const queue = new AsyncEventQueue<EvalSseEvent>();
  let aborted = false;
  let controller: AbortController | null = null;

  async function start(): Promise<void> {
    controller = new AbortController();
    try {
      const res = await fetch("/api/admin/eval/run", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        queue.push({
          event: "error",
          data: { message: `request failed (${String(res.status)}): ${text}` },
        });
        queue.close();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let eventName = "message";
          const dataLines: string[] = [];
          for (const rawLine of chunk.split("\n")) {
            const line = rawLine.trimEnd();
            if (line.startsWith("event:"))
              eventName = line.slice(6).trim();
            else if (line.startsWith("data:"))
              dataLines.push(line.slice(5).trimStart());
          }
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.join("\n");
          let parsed: unknown = dataStr;
          try {
            parsed = JSON.parse(dataStr);
          } catch {
            // keep as string
          }
          queue.push({ event: eventName, data: parsed });
        }
      }
      queue.close();
    } catch (err) {
      if (!aborted) {
        const message = err instanceof Error ? err.message : String(err);
        queue.push({ event: "error", data: { message } });
      }
      queue.close();
    }
  }

  void start();

  return {
    progress: queue,
    abort: () => {
      aborted = true;
      controller?.abort();
      queue.close();
    },
  };
}
