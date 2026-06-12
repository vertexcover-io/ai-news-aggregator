import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import {
  TenantConfigProvider,
  useTenantConfig,
  useTenantPageTitle,
} from "../../../../src/components/shell/TenantConfigProvider";
import { makeTenantConfig } from "../../helpers/tenantConfig";

vi.mock("../../../../src/api/tenantConfig", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../../src/api/tenantConfig")>();
  return { ...original, getTenantConfig: vi.fn() };
});

import { getTenantConfig } from "../../../../src/api/tenantConfig";
const mockGetTenantConfig = vi.mocked(getTenantConfig);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.title = "";
});

function NameProbe(): ReactElement {
  const config = useTenantConfig();
  return <div data-testid="name">{config?.name ?? "none"}</div>;
}

function TitleProbe({ suffix }: { suffix: string }): ReactElement {
  useTenantPageTitle((config) => `${suffix} — ${config.name}`);
  return <div />;
}

function renderWithQuery(children: ReactElement): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <TenantConfigProvider>{children}</TenantConfigProvider>
    </QueryClientProvider>,
  );
}

describe("TenantConfigProvider", () => {
  it("exposes the fetched config via useTenantConfig", async () => {
    mockGetTenantConfig.mockResolvedValue(
      makeTenantConfig({ name: "The Inference" }),
    );
    renderWithQuery(<NameProbe />);
    await waitFor(() => {
      expect(screen.getByTestId("name").textContent).toBe("The Inference");
    });
  });

  it("yields null on the app host (404 → null) and components fall back", async () => {
    mockGetTenantConfig.mockResolvedValue(null);
    renderWithQuery(<NameProbe />);
    await waitFor(() => {
      expect(mockGetTenantConfig).toHaveBeenCalled();
    });
    expect(screen.getByTestId("name").textContent).toBe("none");
  });

  it("sets a default document title from name + headline once loaded", async () => {
    document.title = "A hand-curated daily digest";
    mockGetTenantConfig.mockResolvedValue(
      makeTenantConfig({ name: "The Inference", headline: "Daily inference." }),
    );
    renderWithQuery(<NameProbe />);
    await waitFor(() => {
      expect(document.title).toBe("The Inference — Daily inference.");
    });
  });

  it("does not clobber a page-set title (page effects run first)", async () => {
    document.title = "A hand-curated daily digest";
    mockGetTenantConfig.mockResolvedValue(
      makeTenantConfig({ name: "The Inference" }),
    );
    renderWithQuery(<TitleProbe suffix="Sources" />);
    await waitFor(() => {
      expect(document.title).toBe("Sources — The Inference");
    });
  });

  it("useTenantPageTitle leaves the title alone until config arrives", () => {
    document.title = "untouched";
    render(
      <TenantConfigProvider value={null}>
        <TitleProbe suffix="Sources" />
      </TenantConfigProvider>,
    );
    expect(document.title).toBe("untouched");
  });
});
