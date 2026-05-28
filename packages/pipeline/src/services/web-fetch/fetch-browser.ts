import { chromium } from "playwright-core";
import type { ConvertResult, FetchMode } from "@pipeline/services/web-fetch/types.js";
import { convert } from "@pipeline/services/web-fetch/convert.js";

export interface FetchBrowserOptions {
  signal?: AbortSignal;
}

export function resolveChromiumExecutablePath(): string | undefined {
  const p = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  return p === "" ? undefined : p;
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

  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromiumExecutablePath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

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
