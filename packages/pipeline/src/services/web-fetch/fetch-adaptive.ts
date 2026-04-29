import type { ConvertResult, FetchMode } from "@pipeline/services/web-fetch/types.js";
import { fetchStatic, type FetchStaticOptions } from "@pipeline/services/web-fetch/fetch-static.js";
import { fetchBrowser } from "@pipeline/services/web-fetch/fetch-browser.js";
import { isHealthyResult } from "@pipeline/services/web-fetch/convert.js";

export type FetchAdaptiveOptions = FetchStaticOptions;

export async function fetchAdaptive(
  url: string,
  mode: FetchMode,
  opts: FetchAdaptiveOptions = {},
): Promise<ConvertResult> {
  try {
    const r = await fetchStatic(url, mode, opts);
    if (isHealthyResult(r)) return r;
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    // non-abort error: fall through to browser
  }
  return fetchBrowser(url, mode, { signal: opts.signal });
}
