import type { RouteObject } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ArchivePage } from "./pages/ArchivePage";
import { ReviewPage } from "./pages/ReviewPage";
import { ArchiveListingPage } from "./pages/ArchiveListingPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { PublicLayout } from "./layouts/PublicLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { RequireAdmin } from "./layouts/RequireAdmin";

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <ArchiveListingPage /> },
      { path: "/archive/:runId", element: <ArchivePage /> },
    ],
  },
  { path: "/admin/login", element: <AdminLoginPage /> },
  {
    path: "/admin",
    element: <RequireAdmin />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: "review/:runId", element: <ReviewPage /> },
          { path: "settings", element: <SettingsPage /> },
        ],
      },
    ],
  },
];
