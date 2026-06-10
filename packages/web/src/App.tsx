import type { RouteObject } from "react-router-dom";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ArchivePage } from "./pages/ArchivePage";
import { ReviewPage } from "./pages/ReviewPage";
import { RunObservabilityPage } from "./pages/RunObservabilityPage";
import { SourcesPreviewPage } from "./pages/SourcesPreviewPage";
import { HomePage } from "./pages/HomePage";
import { MustReadPage } from "./pages/MustReadPage";
import { BuiltPage } from "./pages/BuiltPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SourcesPage } from "./pages/SourcesPage";
import { AdminLoginPage } from "./pages/AdminLoginPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { FeedbackPage } from "./pages/FeedbackPage";
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
import { SuperAdminTenantsPage } from "./pages/SuperAdminTenantsPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { PublicLayout } from "./layouts/PublicLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { RequireAdmin } from "./layouts/RequireAdmin";
import { RequireSuperAdmin } from "./layouts/RequireSuperAdmin";
import { RequireOnboarding } from "./layouts/RequireOnboarding";

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/must-read", element: <MustReadPage /> },
      { path: "/built", element: <BuiltPage /> },
      { path: "/archive/:runId", element: <ArchivePage /> },
      { path: "/sources", element: <SourcesPage /> },
      { path: "/confirm", element: <ConfirmPage /> },
      { path: "/feedback", element: <FeedbackPage /> },
      { path: "/unsubscribe", element: <UnsubscribePage /> },
      { path: "/privacy", element: <PrivacyPolicyPage /> },
      { path: "/terms", element: <TermsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "/admin/login", element: <AdminLoginPage /> },
  { path: "/admin/onboarding", element: <OnboardingPage /> },
  {
    path: "/admin",
    element: <RequireAdmin />,
    children: [
      // Super-admin routes (REQ-100): guarded so only super_admin can access
      {
        path: "super",
        element: <RequireSuperAdmin />,
        children: [
          { path: "tenants", element: <SuperAdminTenantsPage /> },
        ],
      },
      // Tenant admin routes, gated by onboarding check
      {
        element: <RequireOnboarding />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "runs/:runId", element: <RunObservabilityPage /> },
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
    ],
  },
];
