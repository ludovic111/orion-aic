import { createHash } from "node:crypto";

// Compares two deployments of the site, route by route: status, the headers
// the server sets and a hash of the body. The CSP names the host (wss://…),
// so it is compared with each host replaced by HOST.
//
//   node scripts/parity.mjs https://orionaic.xyz https://orion-aic.<account>.workers.dev
//
// Exit code 1 when a route differs.

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error("usage: node scripts/parity.mjs <reference URL> <new URL>");
  process.exit(2);
}
const HEADERS = [
  "content-type",
  "cache-control",
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
  "permissions-policy",
  "x-robots-tag",
  "location",
];

async function routes(base) {
  const html = await (await fetch(base)).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
    (m) => m[1],
  );
  return [
    ["GET", "/"],
    ["HEAD", "/"],
    ["GET", "/index.html"],
    ["GET", "/healthz"],
    ["GET", "/api/x"],
    ["GET", "/api/"],
    ["GET", "/sw.js"],
    ["GET", "/manifest.webmanifest"],
    ["GET", "/orion.svg"],
    ["GET", "/icon-192.png"],
    ["GET", "/missing"],
    ["GET", "/assets/missing.js"],
    ["GET", "/assets/"],
    ["GET", "/sync"],
    ["POST", "/"],
    ["PUT", "/index.html"],
    ["DELETE", "/healthz"],
    ...assets.slice(0, 4).map((path) => ["GET", path]),
  ];
}

async function probe(base, method, path) {
  const url = new URL(path, base);
  const res = await fetch(url, { method, redirect: "manual" });
  const body = Buffer.from(await res.arrayBuffer());
  const headers = {};
  for (const name of HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) headers[name] = value.replaceAll(url.host, "HOST");
  }
  return {
    status: res.status,
    headers,
    body: `${body.length} bytes ${createHash("sha256").update(body).digest("hex").slice(0, 12)}`,
  };
}

let differences = 0;
for (const [method, path] of await routes(a)) {
  const [x, y] = await Promise.all([
    probe(a, method, path),
    probe(b, method, path),
  ]);
  const diffs = [];
  if (x.status !== y.status) diffs.push(`status ${x.status} ≠ ${y.status}`);
  for (const name of new Set([
    ...Object.keys(x.headers),
    ...Object.keys(y.headers),
  ]))
    if (x.headers[name] !== y.headers[name])
      diffs.push(
        `${name}: ${x.headers[name] ?? "(none)"} ≠ ${y.headers[name] ?? "(none)"}`,
      );
  if (x.body !== y.body) diffs.push(`body ${x.body} ≠ ${y.body}`);
  console.log(
    `${diffs.length ? "DIFF" : "same"} ${method} ${path} → ${x.status}`,
  );
  for (const d of diffs) console.log(`     ${d}`);
  differences += diffs.length ? 1 : 0;
}
console.log(differences ? `${differences} routes differ` : "all routes match");
process.exit(differences ? 1 : 0);
