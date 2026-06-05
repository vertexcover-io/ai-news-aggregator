import { describe, it, expect } from "vitest";

import { cn } from "@/lib/utils";

describe("cn()", () => {
  it("merges conflicting utility classes so the last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("filters out falsy values", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });
});
