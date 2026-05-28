import { accessSync, constants } from "node:fs";

export function assertChromiumInstalled(): void {
  const path = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (!path) {
    console.error(
      "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is not set. " +
        "Install chromium (apt-get install chromium) and point this env to the binary.",
    );
    process.exit(1);
  }
  try {
    accessSync(path, constants.X_OK);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Chromium binary not executable at ${path}: ${msg}`);
    process.exit(1);
  }
}
