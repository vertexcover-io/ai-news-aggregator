import type { ConvertResult, FetchMode } from "@pipeline/services/web-fetch/types.js";
import { convert } from "@pipeline/services/web-fetch/convert.js";

export interface FetchStaticOptions {
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export async function fetchStatic(
  url: string,
  mode: FetchMode,
  opts: FetchStaticOptions = {},
): Promise<ConvertResult> {
  if (opts.signal?.aborted) {
    throw opts.signal.reason instanceof Error
      ? opts.signal.reason
      : new Error("aborted");
  }
  const f = opts.fetchFn ?? ((u: string, init?: RequestInit) => globalThis.fetch(u, init));
  const res = await f(url, { signal: opts.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return convert({ html, baseUrl: url, mode });
}
