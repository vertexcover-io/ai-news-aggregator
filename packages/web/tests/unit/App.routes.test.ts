import { describe, expect, it } from "vitest";
import type { RouteObject } from "react-router-dom";
import { routes } from "../../src/App";

function findAdminChildren(rs: RouteObject[]): RouteObject[] {
  for (const r of rs) {
    if (r.path === "/admin" && r.children) {
      const layout = r.children.find((c) => c.children);
      return layout?.children ?? [];
    }
  }
  return [];
}

describe("App routes (REQ-030)", () => {
  it("registers /admin → runs/:runId under the AdminLayout children", () => {
    const adminChildren = findAdminChildren(routes);
    const runRoute = adminChildren.find((c) => c.path === "runs/:runId");
    expect(runRoute).toBeTruthy();
    expect(runRoute?.element).toBeTruthy();
  });
});
