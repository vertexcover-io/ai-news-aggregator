import type { RouteObject } from "react-router-dom";
import { SettingsPage } from "./pages/admin/SettingsPage";
import { ArchivePage } from "./pages/ArchivePage";
import { ReviewPage } from "./pages/ReviewPage";
import { RunObservabilityPage } from "./pages/RunObservabilityPage";
import { SourcesPreviewPage } from "./pages/SourcesPreviewPage";
import { HomePage } from "./pages/HomePage";
import { MustReadPage } from "./pages/MustReadPage";
import { BuiltPage } from "./pages/BuiltPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { SourcesPage } from "./pages/SourcesPage";
import { AdminLoginRedirect, LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ConfirmPage } from "./pages/ConfirmPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { EvalManualFixturePage } from "./pages/EvalManualFixturePage";
import { EvalGradePage } from "./pages/EvalGradePage";
import { EvalIndexPage } from "./pages/EvalIndexPage";
import { EvalRunsPage } from "./pages/EvalRunsPage";
import { AdminMustReadListPage } from "./pages/admin/AdminMustReadListPage";
import { AdminMustReadEditPage } from "./pages/admin/AdminMustReadEditPage";
import { AdminIndexRedirect } from "./pages/admin/AdminIndexRedirect";
import { TenantListPage } from "./pages/admin/TenantListPage";
import { OnboardingPage } from "./pages/onboarding/OnboardingPage";
import { UnsubscribePage } from "./pages/UnsubscribePage";
import { PrivacyPolicyPage } from "./pages/PrivacyPolicyPage";
import { TermsPage } from "./pages/TermsPage";
import { PublicLayout } from "./layouts/PublicLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { RequireAuth } from "./layouts/RequireAuth";

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
  { path: "/signup", element: <SignupPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/forgot-password", element: <ForgotPasswordPage /> },
  { path: "/reset-password", element: <ResetPasswordPage /> },
  { path: "/admin/login", element: <AdminLoginRedirect /> },
  {
    // Full-screen wizard — authenticated but outside AdminLayout.
    path: "/onboarding",
    element: <RequireAuth />,
    children: [{ index: true, element: <OnboardingPage /> }],
  },
  {
    path: "/admin",
    element: <RequireAuth />,
    children: [
      {
        element: <AdminLayout />,
        children: [
          { index: true, element: <AdminIndexRedirect /> },
          { path: "tenants", element: <TenantListPage /> },
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
];
