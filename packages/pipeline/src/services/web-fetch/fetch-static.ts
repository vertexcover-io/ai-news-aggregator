import type { Dispatcher } from "undici";
import { ProxyAgent } from "undici";
import type { ConvertResult, FetchMode } from "@pipeline/services/web-fetch/types.js";
import { convert } from "@pipeline/services/web-fetch/convert.js";
import { resolveWebProxyUrl } from "@pipeline/services/web-fetch/proxy.js";

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
  const usingDefaultFetch = opts.fetchFn === undefined;
  const f = opts.fetchFn ?? ((u: string, init?: RequestInit) => globalThis.fetch(u, init));

  const proxyUrl = usingDefaultFetch ? resolveWebProxyUrl() : null;
  const dispatcher: Dispatcher | undefined = proxyUrl
    ? new ProxyAgent(proxyUrl)
    : undefined;

  const init: RequestInit & { dispatcher?: Dispatcher } = { signal: opts.signal };
  if (dispatcher) init.dispatcher = dispatcher;
  const res = await f(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return convert({ html, baseUrl: url, mode });
}
