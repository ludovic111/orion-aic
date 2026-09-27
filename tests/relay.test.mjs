import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";
import { handle } from "../server/app.mjs";
import { LIMITS, attachRelay } from "../server/relay.mjs";
import { slowPost } from "./slow-post.mjs";

const servers = [];
async function relayServer(limits = {}) {
  const server = createServer(handle);
  const relay = attachRelay(server, { limits });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  servers.push({ server, relay });
  return { relay, url: `ws://127.0.0.1:${server.address().port}/sync` };
}
after(() => {
  for (const { server, relay } of servers) {
    relay.close();
    server.close();
  }
});

const room = (c) => c.repeat(64);
/** A post connected to the relay: text controls and binary frames. */
function open(url) {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  const inbox = [];
  const waiters = [];
  const deliver = (value) => {
    const w = waiters.findIndex((x) => x.match(value));
    if (w >= 0) waiters.splice(w, 1)[0].resolve(value);
    else inbox.push(value);
  };
  socket.addEventListener("message", (e) =>
    deliver(
      typeof e.data === "string"
        ? JSON.parse(e.data)
        : { t: "frame", bytes: new Uint8Array(e.data) },
    ),
  );
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
  return { socket, next, ready, join, closed, inbox };
}
/** Binary frame of protocol 2: [1][to: 8][payload]. */
const frame = (payload, to = "") => {
  const out = new Uint8Array(9 + payload.length);
  out[0] = 1;
  if (to) out.set(new TextEncoder().encode(to), 1);
  out.set(payload, 9);
  return out;
};
const bytes = (n, fill = 7) => new Uint8Array(n).fill(fill);

test("relay forwards frames to the other posts of the same room, with the sender id", async () => {
  const { url } = await relayServer();
  const a = open(url);
  const b = open(url);
  const c = open(url);
  const other = open(url);
  const wa = await a.join(room("a"));
  const wb = await b.join(room("a"));
  await c.join(room("a"));
  await other.join(room("b"));
  assert.match(wa.id, /^[0-9a-z]{8}$/);
  assert.notEqual(wa.id, wb.id);
  assert.equal(wa.v, 2);
  await b.next((m) => m.t === "peers" && m.n === 3);
  // To everyone.
  a.socket.send(frame(bytes(40)));
  const got = await b.next((m) => m.t === "frame");
  assert.equal(got.bytes[0], 1);
  assert.equal(new TextDecoder().decode(got.bytes.subarray(1, 9)), wa.id);
  assert.deepEqual(got.bytes.subarray(9), bytes(40));
  await c.next((m) => m.t === "frame");
  // To one post only.
  a.socket.send(frame(bytes(30, 9), wb.id));
  const direct = await b.next((m) => m.t === "frame");
  assert.deepEqual(direct.bytes.subarray(9), bytes(30, 9));
  // A large frame crosses the 64 KiB boundary.
  b.socket.send(frame(bytes(300_000, 3)));
  assert.equal((await a.next((m) => m.t === "frame")).bytes.length, 300_009);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(
    c.inbox.filter((m) => m.t === "frame").length,
    1,
    "the direct frame went to b only",
  );
  assert.equal(other.inbox.filter((m) => m.t === "frame").length, 0);
  a.socket.close();
  assert.equal((await b.next((m) => m.t === "peers" && m.n === 2)).n, 2);
  for (const p of [b, c, other]) p.socket.close();
});

test("relay refuses rooms in the URL (protocol 1), bad rooms and other versions", async () => {
  const { url } = await relayServer();
  const legacy = new WebSocket(`${url}?room=${room("a")}`);
  await new Promise((resolve) => legacy.addEventListener("error", resolve));
  const bad = open(url);
  assert.deepEqual(await bad.join("short"), { t: "error", code: "room", v: 2 });
  const old = open(url);
  assert.equal((await old.join(room("c"), 1)).code, "version");
  const response = await fetch(
    url.replace("ws:", "http:").replace("/sync", "/healthz"),
  );
  assert.equal(await response.text(), "ok");
});

test("relay limits rooms and joins per address, and posts per room", async () => {
  const { url } = await relayServer({ roomsPerIp: 2, peersPerRoom: 2 });
  const posts = [open(url), open(url), open(url)];
  assert.equal((await posts[0].join(room("1"))).t, "welcome");
  assert.equal((await posts[1].join(room("2"))).t, "welcome");
  assert.equal((await posts[2].join(room("3"))).code, "busy");
  const same = open(url);
  assert.equal((await same.join(room("1"))).t, "welcome");
  const third = open(url);
  assert.equal((await third.join(room("1"))).code, "full");
  for (const p of [...posts, same, third]) p.socket.close();

  const limited = await relayServer({ joinBurst: 2, joinRefillMs: 60_000 });
  const first = open(limited.url);
  const second = open(limited.url);
  const flood = open(limited.url);
  assert.equal((await first.join(room("4"))).t, "welcome");
  assert.equal((await second.join(room("4"))).t, "welcome");
  assert.equal((await flood.join(room("4"))).code, "rate");
  for (const p of [first, second, flood]) p.socket.close();

  const few = await relayServer({ socketsPerIp: 1 });
  const one = open(few.url);
  await one.ready;
  const two = new WebSocket(few.url);
  await new Promise((resolve) => two.addEventListener("error", resolve));
  one.socket.close();
});

test("relay closes a frame above its limit and a post that does not read", async () => {
  const { url, relay } = await relayServer({
    payload: 64 * 1024,
    backlog: 256 * 1024,
    stall: 500,
  });
  const big = open(url);
  await big.join(room("d"));
  big.socket.send(frame(bytes(70 * 1024)));
  assert.equal(await big.closed, 1009);

  // A raw socket that joins, then never reads.
  const port = Number(new URL(url).port);
  const slow = connect(port, "127.0.0.1");
  await new Promise((r) => slow.once("connect", r));
  slow.write(
    "GET /sync HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  );
  await new Promise((r) => slow.once("data", r));
  const join = Buffer.from(
    JSON.stringify({ t: "join", room: room("e"), v: 2 }),
  );
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(join.map((b, i) => b ^ mask[i & 3]));
  slow.write(
    Buffer.concat([Buffer.from([0x81, 0x80 | join.length]), mask, masked]),
  );
  await new Promise((r) => setTimeout(r, 50));
  slow.pause();
  const fast = open(url);
  await fast.join(room("e"));
  assert.equal(relay.rooms.get(room("e")).size, 2);
  for (let i = 0; i < 400; i++) fast.socket.send(frame(bytes(60 * 1024)));
  // The relay drops the post that does not read (after the stall timeout)
  // instead of buffering for it.
  for (let i = 0; i < 200 && relay.rooms.get(room("e")).size > 1; i++)
    await new Promise((r) => setTimeout(r, 25));
  assert.equal(relay.rooms.get(room("e")).size, 1);
  slow.destroy();
  fast.socket.close();
});

// ---------- Flow control: slow posts are waited for, not dropped ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PART = 192 * 1024 + 60; // a part of a message, as sent by a post
const MB = 1_000_000;

/**
 * Sends `total` bytes as parts to the post `to` ("" for everyone), waiting
 * like the browser (useSync) while more than 1 MB is buffered.
 */
async function pour(post, total, to, tag) {
  const count = Math.ceil(total / PART);
  for (let i = 0; i < count; i++) {
    while (post.socket.readyState === 1 && post.socket.bufferedAmount > MB)
      await sleep(4);
    if (post.socket.readyState !== 1) throw new Error("sender disconnected");
    const payload = new Uint8Array(PART);
    payload[0] = tag;
    new DataView(payload.buffer).setUint32(1, i);
    post.socket.send(frame(payload, to));
  }
  return count;
}
/** Largest queue of the relay for the post `id`, sampled until stopped. */
function watchQueue(relay, id) {
  let max = 0;
  let paused = 0;
  let samples = 0;
  const timer = setInterval(() => {
    for (const peers of relay.rooms.values())
      for (const peer of peers)
        if (peer.id === id) max = Math.max(max, peer.socket.writableLength);
    samples++;
    if (relay.stats().paused) paused++;
  }, 2);
  return () => {
    clearInterval(timer);
    return { max, pausedShare: samples ? paused / samples : 0 };
  };
}
/** Checks that each sender's parts arrive whole and in order. */
function tally() {
  const next = new Map();
  let bad = 0;
  return {
    onFrame(bytes) {
      const tag = bytes[9];
      const index = new DataView(bytes.buffer, bytes.byteOffset).getUint32(10);
      if (bytes.length !== 9 + PART || index !== (next.get(tag) ?? 0)) bad++;
      next.set(tag, index + 1);
    },
    count: (tag) => next.get(tag) ?? 0,
    bad: () => bad,
  };
}
const mbps = (bytes, ms) => ((bytes / ms) * 1000) / MB;
/** The relay's side of the post `id`. */
const peerOf = (relay, id) => {
  for (const peers of relay.rooms.values())
    for (const peer of peers) if (peer.id === id) return peer;
};
/**
 * Waits until the relay drops `peer` (a post that does not read never sees
 * the close frame): the close code and when.
 */
async function dropped(peer) {
  while (!peer.closed) await sleep(2);
  return { code: peer.closeCode, at: Date.now() };
}

test("a post reading slower than the sender gets 40 MB without being dropped", async (t) => {
  const { url, relay } = await relayServer();
  const got = tally();
  const phone = await slowPost(url, room("5"), {
    rate: 20 * MB,
    onFrame: got.onFrame,
  });
  const sender = open(url);
  await sender.join(room("5"));
  const stop = watchQueue(relay, phone.id());
  const started = Date.now();
  const count = await pour(sender, 40 * MB, phone.id(), 1);
  while (got.count(1) < count && !phone.state.closedAt) await sleep(10);
  const ms = Date.now() - started;
  const { max, pausedShare } = stop();
  assert.equal(phone.state.closedAt, 0, "the slow post stays connected");
  assert.equal(got.count(1), count);
  assert.equal(got.bad(), 0);
  // The relay queues little more than its limit for it.
  assert.ok(max <= LIMITS.backlog + 2 * PART, `queue ${max}`);
  t.diagnostic(
    `1 sender, 40 MB in ${ms} ms (${mbps(40 * MB, ms).toFixed(1)} MB/s, reader at 20 MB/s); relay queue for it at most ${(max / MB).toFixed(2)} MB; sender paused ${(pausedShare * 100).toFixed(0)} % of the time`,
  );
  phone.destroy();
  sender.socket.close();
});

test("a slow post gets 40 MB from each of three posts at once, the relay queue stays bounded", async (t) => {
  const { url, relay } = await relayServer();
  const got = tally();
  const phone = await slowPost(url, room("6"), {
    rate: 25 * MB,
    onFrame: got.onFrame,
  });
  const senders = [open(url), open(url), open(url)];
  for (const s of senders) await s.join(room("6"));
  const stop = watchQueue(relay, phone.id());
  const started = Date.now();
  const counts = await Promise.all(
    senders.map((s, i) => pour(s, 40 * MB, phone.id(), i + 1)),
  );
  while (counts.some((c, i) => got.count(i + 1) < c) && !phone.state.closedAt)
    await sleep(10);
  const ms = Date.now() - started;
  const { max, pausedShare } = stop();
  assert.equal(phone.state.closedAt, 0, "the slow post stays connected");
  counts.forEach((c, i) => assert.equal(got.count(i + 1), c));
  assert.equal(got.bad(), 0);
  // At most one part per sender above the limit.
  assert.ok(max <= LIMITS.backlog + 4 * PART, `queue ${max}`);
  t.diagnostic(
    `3 senders, 120 MB in ${ms} ms (${mbps(120 * MB, ms).toFixed(1)} MB/s, reader at 25 MB/s); relay queue for it at most ${(max / MB).toFixed(2)} MB; a sender paused ${(pausedShare * 100).toFixed(0)} % of the time`,
  );
  phone.destroy();
  for (const s of senders) s.socket.close();
});

test("a post that stops reading is dropped after the stall timeout; the others go on", async (t) => {
  const stall = 1500;
  const { url, relay } = await relayServer({ stall });
  const stuck = await slowPost(url, room("7"), { rate: 0 });
  const sender = open(url);
  const other = open(url);
  await sender.join(room("7"));
  await other.join(room("7"));
  let received = 0;
  other.socket.addEventListener("message", (e) => {
    if (typeof e.data !== "string") received++;
  });
  const stop = watchQueue(relay, stuck.id());
  const peer = peerOf(relay, stuck.id());
  // To everyone: the post that does not read holds the sender back…
  let congestedAt = 0;
  const seen = setInterval(() => {
    if (!congestedAt && peer.congested) congestedAt = Date.now();
  }, 2);
  const [count, { code, at }] = await Promise.all([
    pour(sender, 40 * MB, "", 1),
    dropped(peer),
  ]);
  clearInterval(seen);
  const { max } = stop();
  // …for the stall timeout at most, then it is dropped.
  assert.equal(code, 1013);
  assert.ok(congestedAt, "it was congested");
  const held = at - congestedAt;
  assert.ok(
    held >= stall - 50 && held < stall + 1000,
    `dropped after ${held} ms`,
  );
  assert.equal(relay.stats().congested, 0);
  while (received < count) await sleep(10);
  assert.equal(received, count, "the other post got everything");
  assert.equal(sender.socket.readyState, 1, "the sender stays connected");
  assert.ok(max <= LIMITS.backlog + 2 * PART, `queue ${max}`);
  t.diagnostic(
    `post not reading: dropped (1013) ${held} ms after its queue passed the limit (stall ${stall} ms); relay queue for it at most ${(max / MB).toFixed(2)} MB; the other post got all ${count} parts`,
  );
  stuck.destroy();
  sender.socket.close();
  other.socket.close();
});

test("a post whose queue passes the hard ceiling is dropped at once", async () => {
  const { url, relay } = await relayServer({
    backlog: 256 * 1024,
    hardBacklog: 1024 * 1024,
    stall: 60_000,
  });
  const stuck = await slowPost(url, room("8"), { rate: 0 });
  const senders = Array.from({ length: 6 }, () => open(url));
  for (const s of senders) await s.join(room("8"));
  const peer = peerOf(relay, stuck.id());
  const started = Date.now();
  // Many senders at once, large frames: each may forward one frame after
  // the post is congested, beyond the ceiling.
  const big = new Uint8Array(900 * 1024);
  for (const s of senders)
    for (let i = 0; i < 12; i++) s.socket.send(frame(big, stuck.id()));
  const { code, at } = await dropped(peer);
  assert.equal(code, 1013);
  assert.ok(at - started < 10_000, "well before the stall timeout");
  stuck.destroy();
  for (const s of senders) s.socket.close();
});
