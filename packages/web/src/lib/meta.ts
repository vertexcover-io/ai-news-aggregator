export function setMeta(key: string, content: string): void {
  const isOg = key.startsWith("og:");
  const attr = isOg ? "property" : "name";
  let tag = document.head.querySelector<HTMLMetaElement>(
    `meta[${attr}="${key}"]`,
  );
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attr, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", content);
}
