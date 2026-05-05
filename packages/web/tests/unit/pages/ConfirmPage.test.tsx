import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ConfirmPage } from "../../../src/pages/ConfirmPage";

afterEach(() => {
  cleanup();
});

function renderConfirmPage(search: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/confirm${search}`]}>
      <Routes>
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ConfirmPage", () => {
  it("renders success message for ?status=success", () => {
    renderConfirmPage("?status=success");
    expect(screen.getByText(/You're subscribed!/)).toBeTruthy();
    expect(
      screen.getByText("You'll receive the AI Newsletter in your inbox."),
    ).toBeTruthy();
  });

  it("renders expired message for ?status=expired", () => {
    renderConfirmPage("?status=expired");
    expect(
      screen.getByText("This confirmation link has expired."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Please subscribe again to receive a new confirmation email.",
      ),
    ).toBeTruthy();
  });

  it("renders invalid message for ?status=invalid", () => {
    renderConfirmPage("?status=invalid");
    expect(screen.getByText("This link is invalid.")).toBeTruthy();
  });

  it("redirects to / when status is missing", () => {
    renderConfirmPage("");
    expect(screen.getByText("Home")).toBeTruthy();
  });
});
