export type AddPostSourceType = "hn" | "reddit" | "web";

function isHnUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname === "news.ycombinator.com" && u.pathname === "/item") {
      const id = u.searchParams.get("id");
      return id !== null && /^\d+$/.test(id);
    }
    if (u.hostname === "hn.algolia.com") {
      return /\/story\/[^/]+\/\d+\/(\d+)/.test(u.hash);
    }
    return false;
  } catch {
    return false;
  }
}

function isRedditUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (
      u.hostname !== "www.reddit.com" &&
      u.hostname !== "reddit.com" &&
      u.hostname !== "old.reddit.com"
    ) {
      return false;
    }
    const parts = u.pathname.split("/").filter((p) => p.length > 0);
    if (parts.length < 4 || parts.length > 5) return false;
    return parts[0] === "r" && parts[2] === "comments";
  } catch {
    return false;
  }
}

export function detectAddPostSourceType(url: string): AddPostSourceType {
  if (isHnUrl(url)) return "hn";
  if (isRedditUrl(url)) return "reddit";
  return "web";
}
