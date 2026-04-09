import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".worktrees",
  ".git",
  ".turbo",
  ".next",
  "build",
  "coverage",
]);

const FIXTURE_SUBPATH =
  `${path.sep}tools${path.sep}tests${path.sep}fixtures${path.sep}`;

export function isUnderToolsFixtures(file: string): boolean {
  return file.includes(FIXTURE_SUBPATH);
}

export function walkDir(
  root: string,
  filter: (filePath: string) => boolean,
): string[] {
  const results: string[] = [];
  if (!fs.existsSync(root)) return results;

  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(path.join(current, entry.name));
      } else if (entry.isFile()) {
        const full = path.join(current, entry.name);
        if (filter(full)) results.push(full);
      }
    }
  }
  return results;
}

export function findPackageJsonFiles(cwd: string): string[] {
  const cwdInFixtures = isUnderToolsFixtures(cwd + path.sep);
  return walkDir(
    cwd,
    (f) =>
      path.basename(f) === "package.json" &&
      (cwdInFixtures || !isUnderToolsFixtures(f)),
  );
}
