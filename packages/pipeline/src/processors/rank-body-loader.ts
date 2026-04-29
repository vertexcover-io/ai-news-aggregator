import pLimit from "p-limit";
import { createLogger } from "@newsletter/shared";
import type { Candidate } from "@newsletter/shared";
import { fetchMarkdown } from "@pipeline/services/web-fetch/index.js";

const logger = createLogger("processor:rank-body-loader");

export type BodyFetchFn = (url: string, signal?: AbortSignal) => Promise<string>;

export interface LoadBodiesOptions {
  fetchFn?: BodyFetchFn;
  concurrency?: number;
  timeoutMs?: number;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_ERROR_LENGTH = 200;

function truncateError(message: string): string {
  if (message.length <= MAX_ERROR_LENGTH) return message;
  return `${message.slice(0, MAX_ERROR_LENGTH)}...`;
}

export async function loadBodiesForShortlist(
  candidates: Candidate[],
  options: LoadBodiesOptions = {},
): Promise<Map<number, string | null>> {
  const fetchFn: BodyFetchFn =
    options.fetchFn ?? ((url, signal) => fetchMarkdown(url, { mode: "article", signal }));
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const bodies = new Map<number, string | null>();
  const limit = pLimit(concurrency);

  const tasks: Promise<void>[] = [];

  for (const candidate of candidates) {
    if (candidate.content !== null) {
      bodies.set(candidate.id, candidate.content);
      continue;
    }

    tasks.push(
      limit(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, timeoutMs);
        try {
          const body = await fetchFn(candidate.url, controller.signal);
          bodies.set(candidate.id, body);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          bodies.set(candidate.id, null);
          logger.warn(
            {
              event: "body_fetch_failed",
              url: candidate.url,
              error: truncateError(message),
            },
            "body_fetch_failed",
          );
        } finally {
          clearTimeout(timer);
        }
      }),
    );
  }

  await Promise.all(tasks);
  return bodies;
}
