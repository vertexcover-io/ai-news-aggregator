/**
 * FIX #1: Branding panel in Settings — surfaces the brand identity captured at
 * onboarding (name, headline, topic strip, sub-tagline, logo) for view + edit.
 *
 * - Renders the current branding from GET /api/settings/branding.
 * - Submits edits via PUT; blocks an empty newsletter name.
 * - Shows the logo preview when one is configured.
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BrandingSettings } from "@newsletter/shared/types/tenant";

vi.mock("../../../../src/api/branding", () => ({
  getBrandingSettings: vi.fn(),
  putBrandingSettings: vi.fn(),
  uploadBrandingLogo: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import {
  getBrandingSettings,
  putBrandingSettings,
} from "../../../../src/api/branding";
import { toast } from "sonner";
import { BrandingPanel } from "../../../../src/components/settings/BrandingPanel";

const mockGet = getBrandingSettings as unknown as MockInstance;
const mockPut = putBrandingSettings as unknown as MockInstance;
const mockToastError = toast.error as unknown as MockInstance;

const branding: BrandingSettings = {
  name: "The Inference",
  headline: "The daily read for people building with inference.",
  topicStrip: "Serving · Quantization · Latency",
  subtagline: "Just the runtime.",
  logoUrl: "/api/settings/branding/logo?v=abcd1234",
  hasLogo: true,
};

function renderPanel(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<BrandingPanel />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BrandingPanel (FIX #1)", () => {
  it("renders the current branding fields + logo preview from the API", async () => {
    mockGet.mockResolvedValue(branding);
    renderPanel();

    await waitFor(() => {
      expect(screen.getByLabelText("Newsletter name")).toHaveProperty(
        "value",
        "The Inference",
      );
    });
    expect(screen.getByLabelText("Headline")).toHaveProperty(
      "value",
      "The daily read for people building with inference.",
    );
    expect(screen.getByLabelText("Topic strip")).toHaveProperty(
      "value",
      "Serving · Quantization · Latency",
    );
    const logo = screen.getByAltText("Current logo");
    expect(logo.getAttribute("src")).toBe("/api/settings/branding/logo?v=abcd1234");
  });

  it("submits edited branding via PUT", async () => {
    mockGet.mockResolvedValue(branding);
    mockPut.mockResolvedValue({ ...branding, name: "Renamed" });
    renderPanel();

    await waitFor(() => {
      expect(screen.getByLabelText("Newsletter name")).toHaveProperty(
        "value",
        "The Inference",
      );
    });
    fireEvent.change(screen.getByLabelText("Newsletter name"), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalled();
    });
    expect(mockPut.mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: "Renamed" }),
    );
  });

  it("blocks submit and toasts when the newsletter name is empty", async () => {
    mockGet.mockResolvedValue({ ...branding, name: "" });
    renderPanel();

    // Wait for the data to hydrate (a non-empty field proves the load finished
    // and the Save button is enabled) — name is "" before AND after load.
    await waitFor(() => {
      expect(screen.getByLabelText("Headline")).toHaveProperty(
        "value",
        branding.headline,
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Save branding" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
    expect(mockPut).not.toHaveBeenCalled();
  });
});
