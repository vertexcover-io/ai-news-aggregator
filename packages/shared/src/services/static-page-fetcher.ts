import { canonicalizeFetchUrl } from "./url-safety.js";

export type StaticFetchError =
  | "ssrf"
  | "timeout"
  | "http_4xx"
  | "http_5xx"
  | "non_html"
  | "too_large"
  | "network";

export interface StaticFetchOk {
  html: string;
  finalUrl: string;
}

export interface StaticFetchOpts {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 2_000_000;
const USER_AGENT = "AgentLoop-LinkPreview/1.0";

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function fetchPageStatic(
  url: string,
  opts: StaticFetchOpts,
): Promise<StaticFetchOk | { error: StaticFetchError }> {
  const canonical = canonicalizeFetchUrl(url);
  if (!canonical) return { error: "ssrf" };

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = (): void => {
    controller.abort();
  };
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", onExternalAbort);
  }

  try {
    const res = await globalThis.fetch(canonical, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.status >= 500) return { error: "http_5xx" };
    if (res.status >= 400) return { error: "http_4xx" };

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("text/html")) return { error: "non_html" };

    const finalCanonical = canonicalizeFetchUrl(res.url || canonical);
    if (!finalCanonical) return { error: "ssrf" };

    const reader = res.body?.getReader();
    if (!reader) return { error: "network" };

    let received = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { error: "too_large" };
      }
      chunks.push(value);
    }
    const html = new TextDecoder("utf-8").decode(concatChunks(chunks, received));
    return { html, finalUrl: finalCanonical };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { error: "timeout" };
    return { error: "network" };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener("abort", onExternalAbort);
  }
}
