import { chromium } from "playwright";

export function assertChromiumInstalled(): void {
  try {
    chromium.executablePath();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `Chromium binary missing. Run: pnpm exec playwright install chromium\n  underlying: ${msg}`,
    );
    process.exit(1);
  }
}
