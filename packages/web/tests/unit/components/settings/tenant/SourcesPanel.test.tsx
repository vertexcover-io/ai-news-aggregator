import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import type { SourceRow } from "@newsletter/shared";
import { SourcesPanel } from "../../../../../src/components/settings/tenant/SourcesPanel";

vi.mock("../../../../../src/api/tenant-sources", () => ({
  listSources: vi.fn(),
  addSource: vi.fn(),
  setSourceEnabled: vi.fn(),
  removeSource: vi.fn(),
  discover: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import {
  addSource,
  discover,
  listSources,
  removeSource,
  setSourceEnabled,
} from "../../../../../src/api/tenant-sources";

const sources: SourceRow[] = [
  {
    id: "s1",
    tenantId: "t1",
    type: "hn",
    config: { title: "Hacker News" },
    enabled: true,
    health: { status: "ok" },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "s2",
    tenantId: "t1",
    type: "rss",
    config: { url: "https://vllm.ai/feed.xml" },
    enabled: false,
    health: { status: "failed" },
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

function wrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SourcesPanel", () => {
  it("lists sources with health badges and an active count", async () => {
    vi.mocked(listSources).mockResolvedValue(sources);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <SourcesPanel />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByText("https://vllm.ai/feed.xml")).toBeTruthy();
    });
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("1 active")).toBeTruthy();
  });

  it("toggles a source via the switch", async () => {
    vi.mocked(listSources).mockResolvedValue(sources);
    vi.mocked(setSourceEnabled).mockResolvedValue({
      ...sources[0],
      enabled: false,
    });
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <SourcesPanel />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Enable Hacker News")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("Enable Hacker News"));
    await waitFor(() => {
      expect(setSourceEnabled).toHaveBeenCalledWith("s1", false);
    });
  });

  it("removes a source", async () => {
    vi.mocked(listSources).mockResolvedValue(sources);
    vi.mocked(removeSource).mockResolvedValue(undefined);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <SourcesPanel />
      </Wrapper>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Remove Hacker News")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("Remove Hacker News"));
    await waitFor(() => {
      expect(removeSource).toHaveBeenCalledWith("s1");
    });
  });

  it("discovers suggestions and adds one as a source", async () => {
    vi.mocked(listSources).mockResolvedValue([]);
    vi.mocked(discover).mockResolvedValue([
      { type: "rss", title: "PyTorch blog", url: "https://pytorch.org/blog" },
    ]);
    vi.mocked(addSource).mockResolvedValue(sources[0]);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <SourcesPanel />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText("Discover sources"), {
      target: { value: "inference" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    await waitFor(() => {
      expect(screen.getByText("PyTorch blog")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /PyTorch blog/ }));
    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "rss",
          config: { title: "PyTorch blog", url: "https://pytorch.org/blog" },
        }),
      );
    });
  });

  it("adds a manual reddit source with normalized config", async () => {
    vi.mocked(listSources).mockResolvedValue([]);
    vi.mocked(addSource).mockResolvedValue(sources[0]);
    const Wrapper = wrapper();
    render(
      <Wrapper>
        <SourcesPanel />
      </Wrapper>,
    );
    fireEvent.change(screen.getByLabelText("Source type"), {
      target: { value: "reddit" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/feed\.xml or r\/… or @handle/),
      { target: { value: "r/LocalLLaMA" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => {
      expect(addSource).toHaveBeenCalledWith({
        type: "reddit",
        config: { subreddit: "LocalLLaMA" },
      });
    });
  });
});
