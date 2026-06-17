/**
 * Fix #4: the admin-facing "feature disabled" notice. When an admin lands on a
 * surface whose feature flag is off, they get a warning banner explaining it is
 * disabled plus a button that takes them to Settings to enable it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureDisabledNotice } from "../../../../src/components/admin/FeatureDisabledNotice";

afterEach(cleanup);

function renderNotice(label: string): void {
  render(
    <MemoryRouter>
      <FeatureDisabledNotice featureLabel={label} />
    </MemoryRouter>,
  );
}

describe("FeatureDisabledNotice", () => {
  it("names the disabled feature in a warning message", () => {
    renderNotice("Eval");
    expect(screen.getByRole("alert").textContent).toMatch(/Eval/);
    expect(screen.getByRole("alert").textContent).toMatch(/disabled/i);
  });

  it("links to Settings to enable the feature", () => {
    renderNotice("Eval");
    const link = screen.getByRole("link", { name: /settings/i });
    expect(link.getAttribute("href")).toBe("/admin/settings");
  });
});
