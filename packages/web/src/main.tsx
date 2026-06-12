import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import posthog from "posthog-js";
import { PostHogProvider } from "@posthog/react";
import { routes } from "./App.tsx";
import { TenantConfigProvider } from "./components/shell/TenantConfigProvider";
import { Toaster } from "@/components/ui/sonner";
import { initBrowserAnalytics } from "./lib/analytics";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

const queryClient = new QueryClient();
const router = createBrowserRouter(routes);

function AnalyticsProvider({ children }: { children: ReactNode }): ReactNode {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;
    void initBrowserAnalytics().then((initialized) => {
      if (mounted) setEnabled(initialized);
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (!enabled) return children;

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>;
}

createRoot(rootEl).render(
  <StrictMode>
    <AnalyticsProvider>
      <QueryClientProvider client={queryClient}>
        <TenantConfigProvider>
          <RouterProvider router={router} />
        </TenantConfigProvider>
        <Toaster />
      </QueryClientProvider>
    </AnalyticsProvider>
  </StrictMode>,
);
