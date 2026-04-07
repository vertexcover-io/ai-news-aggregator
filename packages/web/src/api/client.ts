const PASSWORD_STORAGE_KEY = "newsletter_password";

export function getPassword(): string | null {
  return localStorage.getItem(PASSWORD_STORAGE_KEY);
}

export function setPassword(password: string): void {
  localStorage.setItem(PASSWORD_STORAGE_KEY, password);
}

export function clearPassword(): void {
  localStorage.removeItem(PASSWORD_STORAGE_KEY);
}

export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const password = getPassword();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (password) {
    headers.set("Authorization", `Bearer ${password}`);
  }
  return fetch(path, { ...init, headers });
}
