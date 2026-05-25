import { describe, it, expect } from "vitest";
import { buildPublishFailedMessage } from "@shared/slack/builders/publish-failed.js";

describe("buildPublishFailedMessage", () => {
  it("renders header with 'Email was not posted' for email-send channel", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-1",
      channel: "email-send",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("Email was not posted");
  });

  it("renders header with 'LinkedIn was not posted' for linkedin-post channel", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-2",
      channel: "linkedin-post",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("LinkedIn was not posted");
  });

  it("renders header with 'Twitter was not posted' for twitter-post channel", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-3",
      channel: "twitter-post",
    });
    const header = blocks.find(
      (b) => (b as { type: string }).type === "header",
    ) as { type: string; text: { text: string } } | undefined;
    expect(header?.text.text).toBe("Twitter was not posted");
  });

  it("renders section with channel name and not-reviewed-in-time message", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-1",
      channel: "email-send",
    });
    const section = blocks.find(
      (b) => (b as { type: string }).type === "section",
    ) as { type: string; text: { type: string; text: string } } | undefined;
    expect(section?.text.text).toBe(
      "Email was not posted because the newsletter was not reviewed in time.",
    );
  });

  it("renders context with review link when publicArchiveBaseUrl is provided", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-7",
      channel: "email-send",
      publicArchiveBaseUrl: "https://newsletter.example.com",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain("https://newsletter.example.com/admin/review/run-7");
    expect(context?.elements[0].text).toContain("run-7");
  });

  it("strips trailing slash from publicArchiveBaseUrl in review link", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-7",
      channel: "linkedin-post",
      publicArchiveBaseUrl: "https://newsletter.example.com/",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toContain(
      "https://newsletter.example.com/admin/review/run-7",
    );
    expect(context?.elements[0].text).not.toContain("//admin");
  });

  it("renders context with just runId when no publicArchiveBaseUrl", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-5",
      channel: "twitter-post",
    });
    const context = blocks.find(
      (b) => (b as { type: string }).type === "context",
    ) as { type: string; elements: { text: string }[] } | undefined;
    expect(context?.elements[0].text).toBe("runId: run-5");
  });

  it("returns exactly 3 blocks", () => {
    const { blocks } = buildPublishFailedMessage({
      runId: "run-1",
      channel: "email-send",
    });
    expect(blocks).toHaveLength(3);
  });
});
