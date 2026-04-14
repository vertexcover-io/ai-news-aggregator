import type { RouteObject } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ArchivePage } from "./pages/ArchivePage";
import { ReviewPage } from "./pages/ReviewPage";
import { RunPage } from "./pages/RunPage";

export const routes: RouteObject[] = [
  { path: "/", element: <DashboardPage /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "/run", element: <RunPage /> },
  { path: "/archive/:runId", element: <ArchivePage /> },
  { path: "/review/:runId", element: <ReviewPage /> },
];
