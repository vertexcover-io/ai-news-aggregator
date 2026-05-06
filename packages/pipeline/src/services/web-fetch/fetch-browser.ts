import { chromium } from "playwright";
import type { ConvertResult, FetchMode } from "@pipeline/services/web-fetch/types.js";
import { convert } from "@pipeline/services/web-fetch/convert.js";

export interface FetchBrowserOptions {
  signal?: AbortSignal;
}

export async function fetchBrowser(
  url: string,
  mode: FetchMode,
  opts: FetchBrowserOptions = {},
): Promise<ConvertResult> {
  if (opts.signal?.aborted) {
    throw opts.signal.reason instanceof Error
      ? opts.signal.reason
      : new Error("aborted");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    // Close browser on abort signal
    const onAbort = (): void => {
      void browser.close();
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await page.goto(url, { timeout: 20_000, waitUntil: "load" });
      const status = response?.status() ?? 0;
      if (status < 200 || status >= 300) {
        throw new Error(`HTTP ${status} for ${url}`);
      }
      const html = await page.content();
      return convert({ html, baseUrl: url, mode });
    } finally {
      opts.signal?.removeEventListener("abort", onAbort);
    }
  } finally {
    if (browser.isConnected()) await browser.close();
  }
}
