import { describe, expect, it } from "vitest";

import { completedRunsDateWindow } from "@pipeline/repositories/eval-exports.js";

describe("completedRunsDateWindow", () => {
  it("accepts legacy IANA timezone aliases supported by Intl", () => {
    const window = completedRunsDateWindow("2026-05-23", "Asia/Calcutta");

    expect(window).not.toBeNull();
    expect(window?.from.toISOString()).toBe("2026-05-22T18:30:00.000Z");
    expect(window?.to.toISOString()).toBe("2026-05-23T18:29:59.999Z");
  });

  it("returns null for invalid date input", () => {
    expect(completedRunsDateWindow("23/05/2026", "UTC")).toBeNull();
  });
});
