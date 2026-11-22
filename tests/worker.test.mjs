import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { randomBytes } from "node:crypto";
import { contentSecurityPolicy } from "../server/policy.mjs";

// The Cloudflare Worker (worker/index.mjs and its Durable Object relay),
// against a running instance: `npm run test:worker` starts `wrangler dev`
// and sets WORKER_URL; the deploy workflow runs it against workers.dev.
// Skipped when WORKER_URL is not set (plain `npm test`).
const base = process.env.WORKER_URL;
const skip = !base && "WORKER_URL not set (npm run test:worker)";
const origin = base ? new URL(base) : null;
const secure = origin?.protocol === "https:";
const syncUrl = origin ? `${secure ? "wss" : "ws"}://${origin.host}/sync` : "";

const room = () => randomBytes(32).toString("hex");
function open(url = syncUrl) {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const inbox = [];
  const waiters = [];
  socket.addEventListener("message", (e) => {
    const value =
      typeof e.data === "string"
        ? JSON.parse(e.data)
        : { t: "frame", bytes: new Uint8Array(e.data) };
    const w = waiters.findIndex((x) => x.match(value));
    if (w >= 0) waiters.splice(w, 1)[0].resolve(value);
    else inbox.push(value);
  });
  const closed = new Promise((resolve) =>
    socket.addEventListener("close", (e) => resolve(e.code)),
  );
  const next = (match = () => true) => {
    const found = inbox.findIndex(match);
    if (found >= 0) return Promise.resolve(inbox.splice(found, 1)[0]);
    return new Promise((resolve) => waiters.push({ match, resolve }));
  };
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const join = async (id, v = 2) => {
    await ready;
    socket.send(JSON.stringify({ t: "join", room: id, v }));
    return next((m) => m.t === "welcome" || m.t === "error");
  };
  const peers = (n) => next((m) => m.t === "peers" && m.n === n);
  return { socket, next, ready, join, closed, peers, inbox };
}
const frame = (payload, to = "") => {
  const out = new Uint8Array(9 + payload.length);
  out[0] = 1;
  if (to) out.set(new TextEncoder().encode(to), 1);
  out.set(payload, 9);
  return out;
};
const within = (promise, ms = 5000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms),
    ),
  ]);

/** Status of a raw upgrade request (101 or the refusal). */
function upgradeStatus(path, headers = {}) {
  const request = secure ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, origin), {
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        ...headers,
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.end();
  });
}

test(
  "worker: the headers of the Node server on every response",
  { skip },
  async () => {
    for (const [path, method, status] of [
      ["/", "GET", 200],
      ["/healthz", "GET", 200],
      ["/missing.js", "GET", 404],
      ["/api/x", "GET", 404],
      ["/", "POST", 405],
    ]) {
      const res = await fetch(new URL(path, origin), { method });
      assert.equal(res.status, status, `${method} ${path}`);
      const h = res.headers;
      assert.equal(
        h.get("content-security-policy"),
        contentSecurityPolicy(origin.host, secure),
      );
      assert.equal(
        h.get("strict-transport-security"),
        secure ? "max-age=31536000; includeSubDomains" : null,
      );
      assert.equal(h.get("x-content-type-options"), "nosniff");
      assert.equal(h.get("referrer-policy"), "no-referrer");
      assert.equal(h.get("x-frame-options"), "DENY");
      assert.equal(h.get("x-robots-tag"), null, "dist/_headers is not applied");
      assert.match(h.get("permissions-policy"), /camera=\(self\)/);
    }
  },
);

test(
  "worker: static files, cache rules and refusals of server/app.mjs",
  { skip },
  async () => {
    const home = await fetch(new URL("/", origin));
    assert.equal(home.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(home.headers.get("cache-control"), "no-cache");
    const html = await home.text();
    const script = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
    assert.ok(script, "index.html loads a hashed script");
    const asset = await fetch(new URL(script, origin));
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "text/javascript");
    assert.equal(
      asset.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    const index = await fetch(new URL("/index.html", origin));
    assert.equal(await index.text(), html);
    const manifest = await fetch(new URL("/manifest.webmanifest", origin));
    assert.equal(
      manifest.headers.get("content-type"),
      "application/manifest+json",
    );
    const health = await fetch(new URL("/healthz", origin));
    assert.equal(await health.text(), "ok");
    assert.equal(health.headers.get("cache-control"), "no-store");
    for (const path of ["/api/x", "/missing.js", "/assets/"]) {
      const res = await fetch(new URL(path, origin));
      assert.equal(res.status, 404, path);
      assert.equal(await res.text(), "Not found", path);
    }
  },
);

test("worker: upgrade refusals of the Node relay", { skip }, async () => {
  assert.equal(await upgradeStatus("/other"), 404);
  assert.equal(await upgradeStatus(`/sync?room=${room()}`), 426);
  // Node answers 400; Cloudflare's runtime may refuse an unknown WebSocket
  // version itself, with 426, before the Worker runs.
  assert.ok(
    [400, 426].includes(
      await upgradeStatus("/sync", { "Sec-WebSocket-Version": "8" }),
    ),
  );
  assert.equal(
    await upgradeStatus("/sync", { Origin: "https://elsewhere.example" }),
    403,
  );
  assert.equal(await upgradeStatus("/sync", { Origin: origin.origin }), 101);
});

test(
  "worker relay: rooms, peers, broadcast and directed frames with the sender id",
  { skip },
  async () => {
    const id = room();
    const a = open();
    const b = open();
    const c = open();
    const other = open();
    try {
      const wa = await within(a.join(id));
      assert.equal(wa.t, "welcome");
      assert.equal(wa.v, 2);
      assert.match(wa.id, /^[0-9a-z]{8}$/);
      await within(a.peers(1));
      const wb = await within(b.join(id));
      await within(Promise.all([a.peers(2), b.peers(2)]));
      const wc = await within(c.join(id));
      await within(Promise.all([a.peers(3), b.peers(3), c.peers(3)]));
      await within(other.join(room()));
      await within(other.peers(1));

      const payload = randomBytes(64);
      a.socket.send(frame(payload));
      for (const post of [b, c]) {
        const got = await within(post.next((m) => m.t === "frame"));
        assert.equal(got.bytes[0], 1);
        assert.equal(new TextDecoder().decode(got.bytes.subarray(1, 9)), wa.id);
        assert.deepEqual(got.bytes.subarray(9), new Uint8Array(payload));
      }
      // Directed: only c receives it.
      b.socket.send(frame(payload.subarray(0, 12), wc.id));
      const direct = await within(c.next((m) => m.t === "frame"));
      assert.equal(
        new TextDecoder().decode(direct.bytes.subarray(1, 9)),
        wb.id,
      );
      // Large frame (the clients' parts are 192 KiB).
      const big = randomBytes(192 * 1024);
      c.socket.send(frame(big));
      const large = await within(a.next((m) => m.t === "frame"));
      assert.equal(large.bytes.length, 9 + big.length);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(
        a.inbox.filter((m) => m.t === "frame").length,
        0,
        "a got only the broadcast of c",
      );
      assert.equal(
        other.inbox.filter((m) => m.t === "frame").length,
        0,
        "no frame crosses rooms",
      );
      // A post leaves: the others are told.
      c.socket.close();
      await within(Promise.all([a.peers(2), b.peers(2)]));
    } finally {
      for (const post of [a, b, c, other]) post.socket.close();
    }
  },
);

test(
  "worker relay: protocol errors close the connection",
  { skip },
  async () => {
    const old = open();
    assert.deepEqual(await within(old.join(room(), 1)), {
      t: "error",
      code: "version",
      v: 2,
    });
    assert.equal(await within(old.closed), 1008);
    const bad = open();
    assert.equal((await within(bad.join("nope"))).code, "room");
    assert.equal(await within(bad.closed), 1008);
    const garbage = open();
    await garbage.ready;
    garbage.socket.send("{not json");
    assert.equal(await within(garbage.closed), 1003);
    const huge = open();
    await huge.ready;
    huge.socket.send(JSON.stringify({ t: "join", pad: "x".repeat(5000) }));
    assert.equal(await within(huge.closed), 1009);
  },
);

test(
  "worker relay: a connection that never joins is closed after 10 s",
  { skip, timeout: 40_000 },
  async () => {
    const idle = open();
    await idle.ready;
    assert.deepEqual(await within(idle.next(), 15_000), {
      t: "error",
      code: "timeout",
      v: 2,
    });
    // A close started by the alarm completes about 10 s later on Cloudflare
    // (the error message itself arrives on time).
    assert.equal(await within(idle.closed, 15_000), 1008);
  },
);
