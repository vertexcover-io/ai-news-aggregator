import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePostHogConfig } from "../../../src/analytics/posthog-config.js";

describe("REQ-014 / REQ-016 — no new env vars + alerts doc exists", () => {
  it("test_REQ_014_no_new_required_env_vars", () => {
    // With no POSTHOG_* env vars the config must return disabled and not throw.
    let result: ReturnType<typeof resolvePostHogConfig> | undefined;
    expect(() => {
      result = resolvePostHogConfig(null, {} as NodeJS.ProcessEnv);
    }).not.toThrow();
    expect(result).toBeDefined();
    expect(result?.posthogEnabled).toBe(false);
  });

  it("test_REQ_016_alerts_setup_doc_exists", () => {
    // Resolve the repo root from the package dir (process.cwd() = packages/shared when
    // run via `pnpm --filter @newsletter/shared exec vitest run`).
    const repoRoot = path.resolve(process.cwd(), "../..");
    const docPath = path.join(
      repoRoot,
      ".harness/features/posthog-error-tracking/alerts-setup.md",
    );
    expect(fs.existsSync(docPath), `alerts-setup.md not found at ${docPath}`).toBe(true);

    const content = fs.readFileSync(docPath, "utf8");
    // Must contain markers for all three alert types
    expect(content).toMatch(/issue created/i);
    expect(content).toMatch(/spike/i);
    expect(content).toMatch(/pipeline_run_degraded/);
  });
});
