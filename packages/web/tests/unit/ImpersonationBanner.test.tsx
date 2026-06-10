import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";

vi.mock("../../src/api/super-admin", async () => {
  const actual =
    await vi.importActual<typeof import("../../src/api/super-admin")>(
      "../../src/api/super-admin",
    );
  return { ...actual, exitImpersonation: vi.fn() };
});

import { ImpersonationBanner } from "../../src/components/ImpersonationBanner";
import { exitImpersonation } from "../../src/api/super-admin";
import {
  startImpersonation,
  clearImpersonation,
} from "../../src/hooks/useImpersonation";

const exitMock = vi.mocked(exitImpersonation);

function renderBanner(): ReactElement {
  return render(<ImpersonationBanner />).container as unknown as ReactElement;
}

beforeEach(() => {
  exitMock.mockReset();
  clearImpersonation();
  vi.stubGlobal("location", { assign: vi.fn() } as unknown as Location);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ImpersonationBanner", () => {
  it("renders nothing when not impersonating", () => {
    renderBanner();
    expect(screen.queryByTestId("impersonation-banner")).toBeNull();
  });

  it("renders the tenant name when impersonating", () => {
    startImpersonation({ tenantId: "t1", tenantName: "The Inference" });
    renderBanner();
    const banner = screen.getByTestId("impersonation-banner");
    expect(banner.textContent).toContain("The Inference");
  });

  it("clicking exit calls exitImpersonation and clears state", async () => {
    exitMock.mockResolvedValue();
    startImpersonation({ tenantId: "t1", tenantName: "The Inference" });
    renderBanner();
    fireEvent.click(screen.getByTestId("impersonation-exit"));
    await waitFor(() => {
      expect(exitMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        window.sessionStorage.getItem("newsletter.impersonation"),
      ).toBeNull();
    });
  });

  it("surfaces an error when exit fails and stays mounted", async () => {
    exitMock.mockRejectedValue(new Error("nope"));
    startImpersonation({ tenantId: "t1", tenantName: "The Inference" });
    renderBanner();
    fireEvent.click(screen.getByTestId("impersonation-exit"));
    await screen.findByRole("alert");
    expect(screen.getByText("nope")).toBeTruthy();
    expect(screen.getByTestId("impersonation-banner")).toBeTruthy();
  });
});
