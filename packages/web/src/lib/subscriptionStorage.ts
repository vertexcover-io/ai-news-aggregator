const STORAGE_KEY = "newsletter_subscribed";

export function markSubscribed(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
    window.dispatchEvent(new Event("newsletter-subscription-change"));
  } catch {
    // localStorage may be unavailable (private mode, quota); subscribe UI will keep showing.
  }
}

export function readSubscribed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
