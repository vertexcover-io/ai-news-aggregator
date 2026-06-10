import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm, FormProvider } from "react-hook-form";
import type { ReactElement, ReactNode } from "react";
import { SlugStep } from "@/components/onboarding/SlugStep";
import { emptyWizardData, type WizardData } from "@/components/onboarding/types";

vi.mock("@/api/onboarding", () => ({
  checkSlug: vi.fn(),
}));

import { checkSlug } from "@/api/onboarding";
const mockCheckSlug = vi.mocked(checkSlug);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockCheckSlug.mockReset();
});

function Harness({ slug = "" }: { slug?: string }): ReactElement {
  const form = useForm<WizardData>({
    defaultValues: { ...emptyWizardData(), slug },
  });
  return (
    <FormProvider {...form}>
      <SlugStep onBack={() => undefined} onContinue={() => undefined} />
    </FormProvider>
  );
}

function renderWith(node: ReactNode): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("SlugStep — availability feedback", () => {
  it("shows available state and enables Continue", async () => {
    mockCheckSlug.mockResolvedValue("available");
    renderWith(<Harness slug="myslug" />);
    await waitFor(() => {
      expect(screen.getByText(/is available/i)).toBeTruthy();
    });
    const cont = screen.getByRole("button", { name: /continue/i });
    expect((cont as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows taken state and keeps Continue disabled", async () => {
    mockCheckSlug.mockResolvedValue("taken");
    renderWith(<Harness slug="myslug" />);
    await waitFor(() => {
      expect(screen.getByText(/is taken/i)).toBeTruthy();
    });
    const cont = screen.getByRole("button", { name: /continue/i });
    expect((cont as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows invalid state for invalid slug", async () => {
    mockCheckSlug.mockResolvedValue("invalid");
    renderWith(<Harness slug="bad" />);
    await waitFor(() => {
      expect(screen.getByText(/not a valid subdomain/i)).toBeTruthy();
    });
  });

  it("re-checks when the user edits the slug", async () => {
    mockCheckSlug.mockResolvedValue("available");
    renderWith(<Harness slug="one" />);
    await waitFor(() => {
      expect(mockCheckSlug).toHaveBeenCalledWith("one");
    });
    const input = screen.getByLabelText("Subdomain");
    fireEvent.change(input, { target: { value: "two" } });
    await waitFor(() => {
      expect(mockCheckSlug).toHaveBeenCalledWith("two");
    });
  });
});
