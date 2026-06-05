import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTLIST_PROMPT } from "@shared/constants/shortlist-prompt.js";

describe("DEFAULT_SHORTLIST_PROMPT", () => {
  it("is under the 20000 char admin-prompt cap", () => {
    expect(DEFAULT_SHORTLIST_PROMPT.length).toBeLessThan(20000);
  });

  it("mentions the {{N}} placeholder for caller interpolation", () => {
    expect(DEFAULT_SHORTLIST_PROMPT).toContain("{{N}}");
  });

  it("describes the JSON output contract { ids: string[] }", () => {
    expect(DEFAULT_SHORTLIST_PROMPT).toMatch(/ids/);
  });
});
