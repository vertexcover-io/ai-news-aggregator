import { describe, it, expect } from "vitest";
import {
  buildPublishUnavailableMessage,
  type PublishUnavailableReason,
} from "@shared/slack/builders/publish-unavailable.js";

describe("buildPublishUnavailableMessage", () => {
  it("renders header with 'Email was not posted' for email-send channel", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "email-send",
      reason: "no_archive",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("Email was not posted");
  });

  it("renders header with 'LinkedIn was not posted' for linkedin-post channel", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "linkedin-post",
      reason: "latest_failed",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("LinkedIn was not posted");
  });

  it("renders header with 'Twitter was not posted' for twitter-post channel", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "twitter-post",
      reason: "latest_cancelled",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("Twitter was not posted");
  });

  describe("section reason text", () => {
    const cases: { reason: PublishUnavailableReason; expectedText: string }[] = [
      {
        reason: "no_archive",
        expectedText: "Email was not posted. No completed pipeline archive exists yet.",
      },
      {
        reason: "latest_failed",
        expectedText: "Email was not posted. The latest pipeline run failed.",
      },
      {
        reason: "latest_cancelled",
        expectedText: "Email was not posted. The latest pipeline run was cancelled.",
      },
      {
        reason: "latest_unreviewed",
        expectedText: "Email was not posted. The latest pipeline run is still waiting for review.",
      },
    ];

    for (const { reason, expectedText } of cases) {
      it(`renders correct section text for reason '${reason}'`, () => {
        const { blocks } = buildPublishUnavailableMessage({
          channel: "email-send",
          reason,
        });
        const section = blocks.find(
          (b) => (b as { type: string }).type === "section",
        ) as { type: string; text: { text: string } } | undefined;
        expect(section?.text.text).toBe(expectedText);
      });
    }
  });

  it("renders context with 'No run is available.' when runId and base URL are both absent", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "email-send",
      reason: "no_archive",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toBe("No run is available.");
  });

  it("renders context with just runId when runId provided but no base URL", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "email-send",
      reason: "latest_failed",
      runId: "run-5",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toBe("runId: run-5");
  });

  it("renders context with review link when both runId and publicArchiveBaseUrl are provided", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "email-send",
      reason: "latest_unreviewed",
      runId: "run-7",
      publicArchiveBaseUrl: "https://newsletter.example.com",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain(
      "https://newsletter.example.com/admin/review/run-7",
    );
    expect(context?.elements[0].text).toContain("run-7");
  });

  it("strips trailing slash from publicArchiveBaseUrl in review link", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "linkedin-post",
      reason: "latest_unreviewed",
      runId: "run-8",
      publicArchiveBaseUrl: "https://newsletter.example.com/",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain(
      "https://newsletter.example.com/admin/review/run-8",
    );
    expect(context?.elements[0].text).not.toContain("//admin");
  });

  it("renders context with 'No run is available.' when runId absent but base URL present", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "email-send",
      reason: "no_archive",
      publicArchiveBaseUrl: "https://newsletter.example.com",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toBe("No run is available.");
  });

  it("returns exactly 3 blocks", () => {
    const { blocks } = buildPublishUnavailableMessage({
      channel: "email-send",
      reason: "no_archive",
    });
    expect(blocks).toHaveLength(3);
  });
});
