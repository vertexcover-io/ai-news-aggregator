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
import { SignupPage } from "./pages/SignupPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { OnboardingPage } from "./pages/OnboardingPage";
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
import { SuperAdminSettingsPage } from "./pages/SuperAdminSettingsPage";
import { PublicLayout } from "./layouts/PublicLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { RequireAdmin } from "./layouts/RequireAdmin";
import { RequireOnboarding } from "./layouts/RequireOnboarding";
import { RequireSuperAdmin } from "./layouts/RequireSuperAdmin";
import { RequireFeature } from "./layouts/RequireFeature";
import { RequireCanonPublic } from "./layouts/RequireCanonPublic";

export const routes: RouteObject[] = [
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      {
        // Canon page is gone for tenants with the flag off (Fix #4).
        element: <RequireCanonPublic />,
        children: [{ path: "/must-read", element: <MustReadPage /> }],
      },
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
  { path: "/signup", element: <SignupPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  {
    path: "/admin",
    element: <RequireAdmin />,
    children: [
      {
        // Super-admin console (P15, REQ-100): super_admin sessions land
        // here; RequireSuperAdmin bounces tenant admins to their dashboard.
        element: <RequireSuperAdmin />,
        children: [
          { path: "tenants", element: <SuperAdminTenantsPage /> },
          { path: "platform", element: <SuperAdminSettingsPage /> },
        ],
      },
      {
        // pending_setup → funnelled into the wizard; active → wizard exits
        // to the dashboard (P11, REQ-030/035).
        element: <RequireOnboarding />,
        children: [
          { path: "onboarding", element: <OnboardingPage /> },
          {
            element: <AdminLayout />,
            children: [
          { index: true, element: <DashboardPage /> },
          { path: "runs/:runId", element: <RunObservabilityPage /> },
          { path: "review/:runId", element: <ReviewPage /> },
          { path: "sources/:runId", element: <SourcesPreviewPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "analytics", element: <AnalyticsPage /> },
          // Eval routes — gated on the Eval feature flag (Fix #4). A disabled
          // tenant sees the "enable in Settings" notice in place of the page.
          {
            element: <RequireFeature feature="featureEval" label="Eval" />,
            children: [
              { path: "eval", element: <EvalIndexPage /> },
              { path: "eval/runs", element: <EvalRunsPage /> },
              { path: "eval/fixtures/new", element: <EvalManualFixturePage /> },
              { path: "eval/grade/:fixtureId", element: <EvalGradePage /> },
            ],
          },
          // Canon admin routes — gated on the Canon feature flag (Fix #4).
          {
            element: (
              <RequireFeature feature="featureCanon" label="Canon · Must Read" />
            ),
            children: [
              { path: "must-read", element: <AdminMustReadListPage /> },
              { path: "must-read/new", element: <AdminMustReadEditPage /> },
              { path: "must-read/:id", element: <AdminMustReadEditPage /> },
            ],
          },
            ],
          },
        ],
      },
    ],
  },
];
