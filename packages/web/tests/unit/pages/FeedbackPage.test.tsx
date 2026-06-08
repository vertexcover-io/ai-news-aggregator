import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FeedbackPage } from "../../../src/pages/FeedbackPage";

afterEach(() => {
  cleanup();
});

function renderFeedbackPage(search: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/feedback${search}`]}>
      <Routes>
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("FeedbackPage", () => {
  it("thanks a positive (love) response", () => {
    renderFeedbackPage("?status=ok&v=love");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/landing/i);
  });

  it("acknowledges a lukewarm (meh) response with a 'make it sharper' message", () => {
    renderFeedbackPage("?status=ok&v=meh");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/sharper/i);
  });

  it("responds graciously to a negative (nah) response", () => {
    renderFeedbackPage("?status=ok&v=nah");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/honest/i);
  });

  it("still thanks the reader when the rating is ok but unspecified", () => {
    renderFeedbackPage("?status=ok");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/thank|feedback/i);
  });

  it("renders an expired message for ?status=expired", () => {
    renderFeedbackPage("?status=expired");
    expect(screen.getByText("Link Expired")).toBeTruthy();
  });

  it("renders an invalid message for ?status=invalid", () => {
    renderFeedbackPage("?status=invalid");
    expect(screen.getByText("Link Invalid")).toBeTruthy();
  });

  it("redirects to home for an unknown status", () => {
    renderFeedbackPage("?status=bogus");
    expect(screen.getByText("Home")).toBeTruthy();
  });
});
