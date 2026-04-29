import { createServer, type Server } from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));

export function startFixtureServer(
  routes: Record<string, string>,
): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    // robots.txt 404 is fine — crawlee treats it as no restrictions
    const file = routes[url];
    if (!file) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const body = readFileSync(join(here, file), "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") throw new Error("bad addr");
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

export function stopFixtureServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}
