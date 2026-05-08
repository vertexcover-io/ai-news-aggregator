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
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /You're\s+subscribed\./,
    );
    expect(
      screen.getByText(
        "The next edition lands tomorrow morning. Until then, the archive's open.",
      ),
    ).toBeTruthy();
  });

  it("renders expired message for ?status=expired", () => {
    renderConfirmPage("?status=expired");
    expect(screen.getByText("Link Expired")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /This confirmation link has\s+expired\./,
    );
  });

  it("renders invalid message for ?status=invalid", () => {
    renderConfirmPage("?status=invalid");
    expect(screen.getByText("Link Invalid")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(
      /This link doesn't\s+resolve\./,
    );
  });

  it("redirects to / when status is missing", () => {
    renderConfirmPage("");
    expect(screen.getByText("Home")).toBeTruthy();
  });
});
