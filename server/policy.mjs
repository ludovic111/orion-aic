// Response policy shared by the Node server (server/app.mjs) and the
// Cloudflare Worker (worker/index.mjs): content types, cache rules and
// security headers. No Node dependency, so the Worker can bundle it.

export const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".gz": "application/gzip",
  ".png": "image/png",
};
// Map tiles (swisstopo, geo.admin.ch overlays), weather (Open-Meteo), place
// search, elevation profiles, feature info and forest fire danger
// (api3.geo.admin.ch), live hydrology / MeteoSwiss data and the FOEN flood
// map (data.geo.admin.ch) and the current measurement of a FOEN gauging
// station (LINDAS, environment.ld.admin.ch) are optional services queried
// from the browser on demand. The map tiles are listed in
// connect-src too: the service worker fetches them (to keep them offline)
// and a worker's fetch() is governed by connect-src, not img-src. Without
// it every tile fails and the map claims to be offline.
export const MAP_ORIGINS =
  "https://wmts.geo.admin.ch https://wms.geo.admin.ch https://tile.openstreetmap.org";
export const API_ORIGINS =
  "https://api.open-meteo.com https://api3.geo.admin.ch https://data.geo.admin.ch https://environment.ld.admin.ch";
/**
 * Content security policy. Over HTTPS the relay is reached with wss:// only
 * and any http:// sub-request is upgraded, so browsers never flag the page
 * as "not secure".
 */
export function contentSecurityPolicy(host = "", secure = false) {
  const sockets = host
    ? secure
      ? ` wss://${host}`
      : ` wss://${host} ws://${host}`
    : "";
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${MAP_ORIGINS}; connect-src 'self'${sockets} ${API_ORIGINS} ${MAP_ORIGINS}; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; worker-src 'self'${secure ? "; upgrade-insecure-requests" : ""}`;
}

/** Content type of a file of dist/, from its extension. */
export function contentType(path) {
  const dot = path.lastIndexOf(".");
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  return types[ext] || "application/octet-stream";
}

/** Cache rule of a path: hashed build assets are immutable. */
export const cacheControl = (path) =>
  path.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";

/**
 * Headers of every response. `https`: the page was reached over HTTPS (TLS
 * ended by the hosting proxy): HSTS is sent, never on the local-network
 * server, whose certificate is self-signed.
 */
export function securityHeaders(host, secure, https = secure) {
  return [
    ["Content-Security-Policy", contentSecurityPolicy(host, secure)],
    ...(https
      ? [["Strict-Transport-Security", "max-age=31536000; includeSubDomains"]]
      : []),
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "no-referrer"],
    ["X-Frame-Options", "DENY"],
    [
      "Permissions-Policy",
      "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()",
    ],
  ];
}
