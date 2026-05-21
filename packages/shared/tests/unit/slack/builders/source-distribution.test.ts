import { describe, it, expect } from "vitest";
import { buildSourceDistributionMessage } from "@shared/slack/builders/source-distribution.js";
import type { RunSourceTelemetry } from "@shared/types/run.js";

const telemetry: RunSourceTelemetry = {
  sources: [
    {
      sourceType: "hn",
      displayName: "Hacker News",
      status: "completed",
      itemsFetched: 10,
      errors: [],
      retries: 0,
      durationMs: 100,
    },
    {
      sourceType: "reddit",
      displayName: "Reddit",
      status: "failed",
      itemsFetched: 0,
      errors: ["timeout after 15s"],
      retries: 1,
      durationMs: 200,
    },
  ],
  totalItemsFetched: 10,
  totalErrors: 1,
};

describe("buildSourceDistributionMessage", () => {
  // VS-1: renders header and source blocks
  it("renders header block with correct text", () => {
    const { blocks } = buildSourceDistributionMessage({
      runId: "run-1",
      headline: null,
      sourceTelemetry: telemetry,
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header).toBeDefined();
    expect(header?.text.text).toBe("📊 Sources collected");
  });

  it("renders digest headline section when headline is provided", () => {
    const { blocks } = buildSourceDistributionMessage({
      runId: "run-1",
      headline: "AI Tools Dominate This Week",
      sourceTelemetry: telemetry,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const headlineSection = sections.find((s) =>
      s.text.text.includes("AI Tools Dominate This Week"),
    );
    expect(headlineSection).toBeDefined();
    expect(headlineSection?.text.text).toBe("*AI Tools Dominate This Week*");
  });

  it("omits headline section when headline is null", () => {
    const { blocks } = buildSourceDistributionMessage({
      runId: "run-1",
      headline: null,
      sourceTelemetry: telemetry,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const headlineSection = sections.find((s) =>
      s.text.text.startsWith("*") && !s.text.text.includes("📊") && !s.text.text.includes("⚠️"),
    );
    expect(headlineSection).toBeUndefined();
  });

  it("renders per-source item counts in sources block", () => {
    const { blocks } = buildSourceDistributionMessage({
      runId: "run-1",
      headline: null,
      sourceTelemetry: telemetry,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const sourcesBlock = sections.find((s) =>
      s.text.text.includes("📊 Sources"),
    );
    expect(sourcesBlock).toBeDefined();
    expect(sourcesBlock?.text.text).toContain("Hacker News: 10 items");
    expect(sourcesBlock?.text.text).toContain("Reddit: 0 items (failed)");
    expect(sourcesBlock?.text.text).toContain("Total: 10 items fetched");
  });

  it("renders errors block listing sources with errors", () => {
    const { blocks } = buildSourceDistributionMessage({
      runId: "run-1",
      headline: null,
      sourceTelemetry: telemetry,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const errorsBlock = sections.find((s) =>
      s.text.text.includes("⚠️ Errors"),
    );
    expect(errorsBlock).toBeDefined();
    expect(errorsBlock?.text.text).toContain("Reddit");
    expect(errorsBlock?.text.text).toContain("timeout after 15s");
  });

  it("renders 'No collection errors' when no sources have errors", () => {
    const cleanTelemetry: RunSourceTelemetry = {
      sources: [
        {
          sourceType: "hn",
          displayName: "Hacker News",
          status: "completed",
          itemsFetched: 5,
          errors: [],
          retries: 0,
          durationMs: 50,
        },
      ],
      totalItemsFetched: 5,
      totalErrors: 0,
    };
    const { blocks } = buildSourceDistributionMessage({
      runId: "run-1",
      headline: null,
      sourceTelemetry: cleanTelemetry,
    });
    const sections = blocks.filter(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { text: string } }[];
    const errorsBlock = sections.find((s) =>
      s.text.text.includes("⚠️ Errors"),
    );
    expect(errorsBlock?.text.text).toContain("No collection errors");
  });

  it("renders archive context line with link when publicArchiveBaseUrl is provided", () => {
    const { blocks } = buildSourceDistributionMessage({
      runId: "run-1",
      headline: null,
      sourceTelemetry: telemetry,
      publicArchiveBaseUrl: "https://example.com",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context).toBeDefined();
    expect(context?.elements[0].text).toContain("https://example.com/archive/run-1");
    expect(context?.elements[0].text).toContain("run-1");
  });

  it("renders archive context line with runId only when no publicArchiveBaseUrl", () => {
    const { blocks } = buildSourceDistributionMessage({
      runId: "run-42",
      headline: null,
      sourceTelemetry: telemetry,
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toBe("runId: run-42");
  });
});
