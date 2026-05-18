export type AddPostSourceType = "hn" | "reddit" | "web";

export function detectAddPostSourceType(url: string): AddPostSourceType {
  try {
    const u = new URL(url);

    // Hacker News
    if (u.hostname === "news.ycombinator.com" && u.pathname === "/item") {
      const id = u.searchParams.get("id");
      if (id && /^\d+$/.test(id)) return "hn";
    }
    if (u.hostname === "hn.algolia.com") {
      const storyMatch = /\/story\/[^/]+\/\d+\/(\d+)/.exec(u.hash);
      if (storyMatch?.[1]) return "hn";
    }

    // Reddit
    if (
      u.hostname === "www.reddit.com" ||
      u.hostname === "reddit.com" ||
      u.hostname === "old.reddit.com"
    ) {
      const parts = u.pathname.split("/").filter((p) => p.length > 0);
      if (
        parts.length >= 4 &&
        parts.length <= 5 &&
        parts[0] === "r" &&
        parts[2] === "comments"
      ) {
        return "reddit";
      }
    }
  } catch {
    // fall through to "web"
  }
  return "web";
}
