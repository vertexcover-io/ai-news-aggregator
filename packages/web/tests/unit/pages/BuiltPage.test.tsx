import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BuiltPage, LAST_REVIEWED } from "../../../src/pages/BuiltPage";
import { PublicLayout } from "../../../src/layouts/PublicLayout";
import { PIPELINE_STAGES } from "../../../src/components/built/PipelineDiagram";

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

afterEach(cleanup);

function renderBuilt(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/built"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/built" element={<BuiltPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BuiltPage", () => {
  it("REQ-017: renders the headline and sub-deck literal strings", () => {
    renderBuilt();
    expect(
      screen.getByRole("heading", { level: 1, name: "How AgentLoop is built" }),
    ).toBeTruthy();
    expect(screen.getByText("This newsletter writes itself. Almost.")).toBeTruthy();
  });

  it("REQ-018: pipeline contains all 7 stage labels in order", () => {
    const { container } = renderBuilt();
    const pipelineRoot = container.querySelector('[data-section="pipeline"]');
    expect(pipelineRoot).not.toBeNull();
    const text = pipelineRoot?.textContent ?? "";
    const expectedOrder = ["BRAINSTORM", "SPEC", "PLAN", "TDD", "REVIEW", "VERIFY", "SHIP"];
    expect(PIPELINE_STAGES.map((s) => s.name)).toEqual(expectedOrder);
    let lastIdx = -1;
    for (const stage of expectedOrder) {
      const idx = text.indexOf(stage, lastIdx + 1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it("REQ-018: skills table has 9 rows", () => {
    const { container } = renderBuilt();
    const skills = container.querySelector('[data-section="skills"] table tbody');
    expect(skills).not.toBeNull();
    expect(skills?.querySelectorAll("tr").length).toBe(9);
  });

  it("REQ-018: agents table has 4 rows", () => {
    const { container } = renderBuilt();
    const agents = container.querySelector('[data-section="agents"] table tbody');
    expect(agents).not.toBeNull();
    expect(agents?.querySelectorAll("tr").length).toBe(4);
  });

  it("REQ-018: artifacts table has 6 rows", () => {
    const { container } = renderBuilt();
    const arts = container.querySelector('[data-section="artifacts"] table tbody');
    expect(arts).not.toBeNull();
    expect(arts?.querySelectorAll("tr").length).toBe(6);
  });

  it("REQ-018: renders THE ARGUMENT, THE GUARDRAILS, TRY IT YOURSELF eyebrows", () => {
    renderBuilt();
    expect(screen.getByText("THE ARGUMENT")).toBeTruthy();
    expect(screen.getByText("THE GUARDRAILS")).toBeTruthy();
    expect(screen.getByText("TRY IT YOURSELF")).toBeTruthy();
  });

  it("REQ-019: LAST_REVIEWED export matches ISO-8601 date string", () => {
    expect(LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("REQ-019: BuiltPage.tsx source file contains the LAST_REVIEWED export literal", () => {
    const filePath = resolve(
      process.cwd(),
      "src/pages/BuiltPage.tsx",
    );
    const source = readFileSync(filePath, "utf8");
    expect(source).toMatch(/^export const LAST_REVIEWED = "\d{4}-\d{2}-\d{2}";/m);
  });
});
