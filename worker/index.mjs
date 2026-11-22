import {
  cacheControl,
  contentType,
  securityHeaders,
} from "../server/policy.mjs";

// Cloudflare Worker of orionaic.xyz: the same responses as the Node server
// (server/app.mjs), built from the static files of dist/ (Workers static
// assets, binding ASSETS), and the live synchronisation relay /sync, run by
// one Durable Object (worker/relay.mjs) instead of server/relay.mjs. The
// Worker runs first on every request (run_worker_first), so the headers of
// every response are the ones set here, never those of dist/_headers.

export { Relay } from "./relay.mjs";

const NOT_FOUND = new TextEncoder().encode("Not found");

/**
 * WebSocket upgrade: the same refusals as the Node relay, before the Durable
 * Object (which counts connections per address) sees the request.
 */
function upgrade(request, url, env) {
  const reject = (status) => new Response(null, { status });
  try {
    if (url.pathname !== "/sync") return reject(404);
    // Protocol 1 put the room in the URL: such a page must be reloaded.
    if (url.searchParams.has("room")) return reject(426);
    if (
      !request.headers.has("Sec-WebSocket-Key") ||
      request.headers.get("Sec-WebSocket-Version") !== "13" ||
      (request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket"
    )
      return reject(400);
    // Browsers send Origin: only pages of this site may join a room.
    const origin = request.headers.get("Origin");
    if (origin && new URL(origin).host !== url.host) return reject(403);
    // One relay for every room, like the single Node process it replaces:
    // the limits per address and the total number of rooms stay global.
    const relay = env.RELAY.get(env.RELAY.idFromName("relay"), {
      locationHint: "weur",
    });
    return relay.fetch(request);
  } catch {
    return reject(400);
  }
}

/**
 * Path of the file of dist/ for a decoded URL path, resolved like
 * path.resolve() on the Node server: "." and ".." segments and trailing
 * slashes do not count; "" when it leaves dist/, "/" for dist/ itself.
 */
function resolveFile(path) {
  const parts = [];
  for (const part of (path === "/" ? "/index.html" : path).split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return "";
      parts.pop();
    } else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.has("Upgrade")) return upgrade(request, url, env);
    // TLS ends at Cloudflare's edge: workers.dev and the custom domains are
    // HTTPS only (`wrangler dev` is plain HTTP).
    const secure = url.protocol === "https:";
    const headers = new Headers(securityHeaders(url.host, secure));
    const reply = (status, body = null) =>
      new Response(body, { status, headers });
    // The site stores nothing: every write (POST, PUT…) is refused.
    if (request.method !== "GET" && request.method !== "HEAD")
      return reply(405);
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return reply(404, NOT_FOUND);
    }
    if (path === "/healthz") {
      headers.set("Content-Type", "text/plain; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      return reply(200, "ok");
    }
    if (path.startsWith("/api/") || path.includes("\0"))
      return reply(404, NOT_FOUND);
    const file = resolveFile(path);
    if (!file || file === "/") return reply(404);
    const asset = await env.ASSETS.fetch(
      new Request(
        new URL(file.split("/").map(encodeURIComponent).join("/"), url),
        { method: request.method },
      ),
    );
    if (asset.status !== 200) {
      await asset.body?.cancel();
      return reply(404, NOT_FOUND);
    }
    headers.set("Content-Type", contentType(file));
    headers.set("Cache-Control", cacheControl(path));
    return reply(200, request.method === "HEAD" ? null : asset.body);
  },
};
