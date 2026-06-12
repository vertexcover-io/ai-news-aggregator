import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BuiltPage } from "../../../src/pages/BuiltPage";
import { PublicLayout } from "../../../src/layouts/PublicLayout";
import { AGENTLOOP_BRANDING } from "../../helpers/branding";
import { PIPELINE_STAGES } from "../../../src/components/built/PipelineDiagram";

vi.mock("../../../src/api/subscribe", () => ({
  postSubscribe: vi.fn(),
}));

vi.mock("../../../src/api/branding", () => ({
  getBranding: vi.fn(() => Promise.resolve(AGENTLOOP_BRANDING)),
}));

vi.mock("../../../src/lib/analytics", () => ({
  captureBrowserEvent: vi.fn(),
}));

afterEach(cleanup);

function renderBuilt(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  qc.setQueryData(["branding"], AGENTLOOP_BRANDING);
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

  it("REQ-018: section eyebrows render in order", () => {
    const { container } = renderBuilt();
    const text = container.textContent ?? "";
    const expectedOrder = [
      "THE ARGUMENT",
      "WHAT IT TAKES",
      "THE SPEC → SHIP LOOP",
      "THE COMPOUNDING LOOPS",
      "HOW THE NEWSLETTER WORKS",
      "INSIDE THE HARNESS",
      "VERTEXCOVER LABS",
      "TRY IT YOURSELF",
    ];
    let lastIdx = -1;
    for (const eyebrow of expectedOrder) {
      const idx = text.indexOf(eyebrow, lastIdx + 1);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it.each([
    { label: "three pillars", selector: '[data-section="three-pillars"] h3', count: 3 },
    { label: "five compounding-loop entries", selector: '[data-section="compounding"] h4', count: 5 },
    { label: "newsletter pipeline dt rows", selector: '[data-section="newsletter"] dt', count: 7 },
    { label: "skills table rows", selector: '[data-section="skills"] table tbody tr', count: 9 },
    { label: "agents table rows", selector: '[data-section="agents"] table tbody tr', count: 4 },
    { label: "artifacts table rows", selector: '[data-section="artifacts"] table tbody tr', count: 6 },
  ])("REQ-018: $label render ($count)", ({ selector, count }) => {
    const { container } = renderBuilt();
    expect(container.querySelectorAll(selector).length).toBe(count);
  });

  it("REQ-018: inside-the-harness disclosure exists", () => {
    const { container } = renderBuilt();
    const disclosure = container.querySelector('[data-section="inside-harness"] details');
    expect(disclosure).not.toBeNull();
  });

  it("REQ-018: try-it CTAs link to repos + mailto in order", () => {
    const { container } = renderBuilt();
    const tryIt = container.querySelector('[data-section="try-it"]');
    expect(tryIt).not.toBeNull();
    const hrefs = Array.from(tryIt?.querySelectorAll("a") ?? []).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual([
      "https://github.com/vertexcover-io/ai-news-aggregator",
      "https://github.com/vertexcover-io/harness-engineering",
      "mailto:hello@agentloop.vertexcover.io",
    ]);
  });
});
