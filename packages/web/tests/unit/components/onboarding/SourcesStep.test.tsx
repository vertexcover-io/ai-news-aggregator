import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm, FormProvider } from "react-hook-form";
import type { ReactElement, ReactNode } from "react";
import { SourcesStep } from "@/components/onboarding/SourcesStep";
import {
  emptyWizardData,
  type WizardData,
  type SelectedSource,
} from "@/components/onboarding/types";

vi.mock("@/api/onboarding", () => ({
  discoverSources: vi.fn(),
}));

import { discoverSources } from "@/api/onboarding";
const mockDiscover = vi.mocked(discoverSources);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockDiscover.mockReset();
});

function Harness({
  sources = [],
}: {
  sources?: SelectedSource[];
}): ReactElement {
  const form = useForm<WizardData>({
    defaultValues: { ...emptyWizardData(), blurb: "inference", sources },
  });
  return (
    <FormProvider {...form}>
      <SourcesStep onBack={() => undefined} onContinue={() => undefined} />
    </FormProvider>
  );
}

function renderWith(node: ReactNode): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("SourcesStep — add/remove", () => {
  it("Continue is disabled with no sources, enabled after adding one", () => {
    renderWith(<Harness />);
    const cont = screen.getByRole("button", { name: /continue/i });
    expect((cont as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Add manually"), {
      target: { value: "@tri_dao" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const selected = screen.getByTestId("selected-sources");
    expect(within(selected).getByText("@tri_dao")).toBeTruthy();
    expect((cont as HTMLButtonElement).disabled).toBe(false);
  });

  it("removes a selected source", () => {
    renderWith(
      <Harness
        sources={[{ type: "reddit", name: "r/LocalLLaMA", config: {} }]}
      />,
    );
    const selected = screen.getByTestId("selected-sources");
    expect(within(selected).getByText("r/LocalLLaMA")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove r/LocalLLaMA" }),
    );
    expect(within(selected).queryByText("r/LocalLLaMA")).toBeNull();
  });

  it("adds a discovered suggestion via click and dedupes", async () => {
    mockDiscover.mockResolvedValue([
      { type: "reddit", name: "r/CUDA", config: {} },
    ]);
    renderWith(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /suggest sources/i }));

    const pill = await screen.findByRole("button", { name: /\+ r\/CUDA/ });
    fireEvent.click(pill);

    const selected = screen.getByTestId("selected-sources");
    expect(within(selected).getByText("r/CUDA")).toBeTruthy();
    // suggestion pill becomes disabled (already added)
    await waitFor(() => {
      expect((pill as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
