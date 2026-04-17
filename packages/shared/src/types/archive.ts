export interface ArchiveListItem {
  runId: string;
  runDate: string;
  storyCount: number;
}

export interface ArchiveListResponse {
  archives: ArchiveListItem[];
}

export interface AdminLoginRequest {
  password: string;
}

export interface AdminLoginResponse {
  ok: true;
}

export interface AdminMeResponse {
  admin: true;
}
