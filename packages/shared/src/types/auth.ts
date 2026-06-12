import type { TenantStatus, UserRole } from "../db/schema.js";

export interface SignupRequest {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  password: string;
  confirmPassword: string;
}

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
}

export interface SessionTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
}

export interface SignupResponse {
  user: SessionUser;
  tenant: { id: string; status: TenantStatus };
}

export interface LoginResponse {
  user: SessionUser;
}

export interface MeResponse {
  user: SessionUser;
  tenant: SessionTenant | null;
  impersonating: boolean;
}
