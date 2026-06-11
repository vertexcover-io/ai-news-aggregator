export type TenantStatus = "pending_setup" | "active";
export type UserRole = "super_admin" | "tenant_admin";

export interface OnboardingState {
  currentStep?: string;
  data?: Record<string, unknown>;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  customDomain: string | null;
  headline: string | null;
  topicStrip: string | null;
  subtagline: string | null;
  logoBytes: Buffer | null;
  logoContentType: string | null;
  featureCanon: boolean;
  featureDeliverability: boolean;
  featureEval: boolean;
  onboardingState: OnboardingState | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}
