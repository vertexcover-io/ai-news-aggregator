import type { RouteObject } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ArchivePage } from "./pages/ArchivePage";
import { ReviewPage } from "./pages/ReviewPage";
import { SourcesPreviewPage } from "./pages/SourcesPreviewPage";
import { HomePage } from "./pages/HomePage";
import { MustReadPage } from "./pages/MustReadPage";
import { BuiltPage } from "./pages/BuiltPage";
import { RssPage } from "./pages/RssPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SourcesPage } from "./pages/SourcesPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { EvalManualFixturePage } from "./pages/EvalManualFixturePage";
import { EvalGradePage } from "./pages/EvalGradePage";
import { EvalIndexPage } from "./pages/EvalIndexPage";
import { EvalRunsPage } from "./pages/EvalRunsPage";
import { AdminMustReadListPage } from "./pages/admin/AdminMustReadListPage";
import { AdminMustReadEditPage } from "./pages/admin/AdminMustReadEditPage";
import { UnsubscribePage } from "./pages/UnsubscribePage";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { TermsPage } from "./pages/TermsPage";
import { PublicLayout } from "./layouts/PublicLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { RequireAdmin } from "./layouts/RequireAdmin";

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/must-read", element: <MustReadPage /> },
      { path: "/built", element: <BuiltPage /> },
      { path: "/rss", element: <RssPage /> },
      { path: "/archive/:runId", element: <ArchivePage /> },
      { path: "/sources", element: <SourcesPage /> },
      { path: "/confirm", element: <ConfirmPage /> },
      { path: "/unsubscribe", element: <UnsubscribePage /> },
      { path: "/privacy", element: <PrivacyPolicyPage /> },
      { path: "/terms", element: <TermsPage /> },
      { path: "*", element: <NotFoundPage /> },
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
          { path: "sources/:runId", element: <SourcesPreviewPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "analytics", element: <AnalyticsPage /> },
          { path: "eval", element: <EvalIndexPage /> },
          { path: "eval/runs", element: <EvalRunsPage /> },
          { path: "eval/fixtures/new", element: <EvalManualFixturePage /> },
          { path: "eval/grade/:fixtureId", element: <EvalGradePage /> },
          { path: "must-read", element: <AdminMustReadListPage /> },
          { path: "must-read/new", element: <AdminMustReadEditPage /> },
          { path: "must-read/:id", element: <AdminMustReadEditPage /> },
        ],
      },
    ],
  },
];
