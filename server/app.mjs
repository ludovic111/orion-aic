import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { cacheControl, contentType, securityHeaders } from "./policy.mjs";

// The policy (CSP, map and API origins) lives in policy.mjs, shared with the
// Cloudflare Worker; re-exported here for the existing imports.
export { API_ORIGINS, MAP_ORIGINS, contentSecurityPolicy } from "./policy.mjs";

// Static files of the built application. The server stores nothing: every
// write (POST, PUT…) is refused and journal contents never reach it.
const root = resolve("dist");

export async function handle(req, res) {
  // Behind a hosting proxy, TLS ends at the proxy.
  const proxied = String(req.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim();
  const secure = proxied === "https" || !!req.socket?.encrypted;
  // Public site: browsers must always come back over HTTPS (HSTS is not sent
  // on the local-network server, whose certificate is self-signed).
  for (const [name, value] of securityHeaders(
    req.headers.host,
    secure,
    proxied === "https",
  ))
    res.setHeader(name, value);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/healthz") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (path.startsWith("/api/") || path.includes("\0")) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(root + sep)) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!(await stat(file)).isFile()) throw new Error("Not a file");
    res.setHeader("Content-Type", contentType(file));
    res.setHeader("Cache-Control", cacheControl(path));
    res.writeHead(200);
    res.end(req.method === "HEAD" ? undefined : await readFile(file));
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}
