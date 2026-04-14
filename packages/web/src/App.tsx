import type { RouteObject } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ArchivePage } from "./pages/ArchivePage";
import { ReviewPage } from "./pages/ReviewPage";

export const routes: RouteObject[] = [
  { path: "/", element: <DashboardPage /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "/run", element: <Navigate to="/settings" replace /> },
  { path: "/archive/:runId", element: <ArchivePage /> },
  { path: "/review/:runId", element: <ReviewPage /> },
];
