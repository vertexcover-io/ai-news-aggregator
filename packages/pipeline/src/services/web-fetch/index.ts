import type { FetchMode } from "@pipeline/services/web-fetch/types.js";
import { fetchAdaptive } from "@pipeline/services/web-fetch/fetch-adaptive.js";

export * from "@pipeline/services/web-fetch/convert.js";
export * from "@pipeline/services/web-fetch/types.js";
export { fetchStatic } from "@pipeline/services/web-fetch/fetch-static.js";
export { fetchBrowser } from "@pipeline/services/web-fetch/fetch-browser.js";
export { fetchAdaptive } from "@pipeline/services/web-fetch/fetch-adaptive.js";

export interface FetchMarkdownOptions {
  mode: FetchMode;
  signal?: AbortSignal;
}

export async function fetchMarkdown(
  url: string,
  opts: FetchMarkdownOptions,
): Promise<string> {
  const r = await fetchAdaptive(url, opts.mode, { signal: opts.signal });
  return r.markdown;
}
